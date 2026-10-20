import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createAiRoutes, composeNodePrompt, nodeRoutes, validateNodeResult } from "../server/http/ai-routes.js";
import { createAppRuntime } from "../server/runtime/app-runtime.js";
import { createTaskHttpHandler } from "../server/http/task-routes.js";
import { modelStore } from "../server/data/model-settings.js";
import { emptyProject } from "../shared/project_contract.js";
import { elysiumClient } from "../server/http/elysium/client.js";
import { llmServerClient } from "../server/http/llm-server/client.js";
import { withGatewayTrace } from "../server/gateway/gateway-trace.js";
import { config, sampleInput, renderTaskPrompt } from "./fixtures/ai.js";
import { snapshotFixture, taskFixture, projectFixture } from "./fixtures/project.js";
import { taskNodeInput } from "../server/handlers/node-inputs.js";
import { emptyCharacterModel } from "../shared/models/character_model.js";
import { dependencyHash } from "../shared/node-dependencies.js";
import seconds from "../server/http/nodes/seconds.js";
import { emptyStoryboardBeatModel } from "../shared/models/storyboard_beat_model.js";
import { assertPromptDialogue } from "../shared/dialogue-integrity.js";
import { assertProgramReview, assertOverride } from "../shared/node-state.js";
import { createId } from "../shared/task_contract.js";
import { commitContent } from "../server/handlers/content.js";
import { shotsBudget } from "../server/prompts/duration-policy.js";

describe("ai-routes", () => {
  test('画面与空间规则贯穿三动作，实际消息保留补充需求和前镜交接，支持正向转写', () => {
    for (const model of ['qwen3.5:27b', 'codex-gpt']) {
      for (const node of ['outline', 'shots', 'seconds', 'storyboard']) {
        const route = nodeRoutes[node];
        for (const action of ['generate', 'regenerate', 'review']) {
          const input = { ...sampleInput(route.actions[action].input), requirements: '表现环境纵深与动作反馈-需求标记' };
          if (node === 'seconds') {
            input.previous = { shot_number: 'S01', end_state: '甲在石柱东侧面向乙-空间标记', pending_actions: '', pending_dialogue: '', continuing_audio: '', last_beats: [emptyStoryboardBeatModel()] };
          }
          const prompt = composeNodePrompt(node, action, input, model);
          assert.equal(prompt.system.split('根据剧情与补充需求确定表达重点').length - 1, 1, `${node}/${action}/${model}`);
          assert.match(prompt.system, /不以不够精彩或个人风格偏好拒绝/);
          const user = prompt.messages.filter(message => message.role === 'user').map(message => message.content).join('\n');
          assert.ok(user.includes(input.requirements), `${node}/${action}/${model}: 补充需求保留`);
          if (node === 'outline') continue;
          assert.equal(prompt.system.split('同一连续场景以固定地标和人物相对关系').length - 1, 1);
          assert.match(prompt.system, /反打可改变画面左右，不代表人物换位/);
          assert.match(prompt.system, /明确换场或时间省略按新场景重建/);
          assert.match(prompt.system, /不把负面清单、审核禁令或修改指令写进正文/);
          assert.match(prompt.system, /保留原台词中的否定词/);
          if (node === 'seconds') assert.match(user, /甲在石柱东侧面向乙-空间标记/);
        }
      }
    }
  });
  const input = { script: '阿明寻找钥匙，最终在门口找到。', language: 'zh-CN', requirements: '用一句话概括。' };
  const completion = content => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }));
  const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
  const close = async server => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };

  test('所有文本节点修订使用四条消息，意见只在最后，system 不再附角色', () => {
    for (const [node, route] of Object.entries(nodeRoutes)) {
      const contract = route.actions.regenerate;
      if (!contract || !['文本', 'JSON'].includes(contract.output.type)) continue;
      const input = { ...sampleInput(contract.input), opinion: '本轮意见唯一标记' };
      const prompt = composeNodePrompt(node, 'regenerate', input, 'qwen3.5:27b');
      assert.deepEqual(prompt.messages.map(message => message.role), ['system', 'user', 'assistant', 'user'], node);
      assert.equal(prompt.messages[2].content, typeof input.content === 'string' ? input.content : JSON.stringify(input.content, null, 2));
      assert.equal(prompt.messages.slice(0, 3).some(message => message.content.includes(input.opinion)), false);
      assert.match(prompt.messages[3].content, /本轮意见唯一标记/);
      assert.doesNotMatch(prompt.system, /^# 角色$|system 中的角色/m);
      assert.equal(Object.hasOwn(route.promptModel, 'role'), false);
      assert.equal(Object.values(route.promptModel).filter(Boolean).some(stage => Object.hasOwn(stage, 'role')), false);
    }
  });

  test('两个文本服务实际 HTTP 原样发送并记录多轮消息，不重复原稿和意见', async () => {
    const requests = [];
    const server = createServer(async (req, res) => {
      let raw = ''; for await (const chunk of req) raw += chunk;
      requests.push(JSON.parse(raw));
      res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '修改后的摘要' } }] }));
    });
    try {
      const url = `${await listen(server)}/v1`;
      for (const model of ['qwen3.5:27b', 'codex-gpt']) {
        const ai = createAiRoutes({ readConfig: async () => ({ ...config, baseUrl: url, textBaseUrl: url, text: { model } }) });
        let saved, savedHttp;
        const { prompt } = await ai('project-summary', 'regenerate', { ...input, content: '原稿唯一标记', opinion: '意见唯一标记' }, { record: async value => { if (value.prompt) saved = structuredClone(value.prompt); if (value.http) savedHttp = structuredClone(value.http); } });
        assert.deepEqual(requests.at(-1).messages, prompt.messages);
        assert.deepEqual(saved.messages, requests.at(-1).messages);
        assert.deepEqual(savedHttp.at(-1).request.body.messages, prompt.messages);
        for (const key of ['system', 'user', 'body', 'transfers']) assert.equal(Object.hasOwn(saved, key), false, key);
        assert.equal(JSON.stringify(prompt.messages).split('原稿唯一标记').length - 1, 1);
        assert.equal(JSON.stringify(prompt.messages).split('意见唯一标记').length - 1, 1);
      }
    } finally { await close(server); }
  });

  test('自动修订使用本任务最近原始结果；排除审核、未来和其他任务结果', () => {
    const snapshot = snapshotFixture(), project = snapshot.project;
    const task = taskFixture(project, 'project-summary', project.basic_info.id, { opinion: '保留结局' });
    snapshot.steps = [
      { task_id: task.id, kind: 'generate', step_status: 'done', seq: 1, result: '第一轮结果' },
      { task_id: task.id, kind: 'revise', step_status: 'done', seq: 3, result: '最新原始结果' },
      { task_id: task.id, kind: 'review', step_status: 'rejected', seq: 4, result: { 原因: '最新审核意见' } },
      { task_id: 'other', kind: 'revise', step_status: 'done', seq: 4, result: '其他任务结果' },
      { task_id: task.id, kind: 'revise', step_status: 'done', seq: 8, result: '未来结果' },
    ];
    const prompt = renderTaskPrompt(snapshot, task, { body: '已转换的候选' }, 'regenerate', { kind: 'revise', seq: 5 });
    assert.equal(prompt.messages[2].content, '最新原始结果');
    assert.match(prompt.messages[3].content, /最新审核意见/);
    assert.doesNotMatch(prompt.body, /其他任务结果|未来结果|已转换的候选|第一轮结果/);
    const manual = renderTaskPrompt(snapshot, task, { body: '当前正式内容' }, 'regenerate');
    assert.equal(manual.messages[2].content, '当前正式内容');
  });

  test('同一节点 HTTP 路由四项业务输入，切换两个来源，统一返回且不写正式项目', async () => {
    const home = await mkdtemp(join(tmpdir(), 'meiji-ai-routes-')), calls = [];
    const upstream = source => createServer(async (req, res) => {
      let raw = ''; for await (const chunk of req) raw += chunk;
      calls.push({ source, auth: req.headers.authorization, path: req.url, payload: JSON.parse(raw) });
      res.end(JSON.stringify({ choices: [{ message: { content: '阿明在门口找回钥匙。' }, finish_reason: 'stop' }] }));
    });
    const remote = upstream('elysium'), local = upstream('llm-server');
    let runtime, api;
    try {
      const settings = { ...config, baseUrl: `${await listen(remote)}/v1`, textBaseUrl: `${await listen(local)}/v1`, apiKey: 'private-route-key' };
      await modelStore(home).write(settings);
      runtime = await createAppRuntime({ home });
      const project = emptyProject({ basic_info: { name: '节点路由', creation_mode: '剧本' } }); project.script_revision.body = input.script;
      const stored = await runtime.repository.create(project), before = stored.read();
      const sid = `session-${randomUUID()}`;
      await runtime.bindings.bind(sid, project.basic_info.id);
      api = createServer(createTaskHttpHandler(runtime, { authorize: req => req.headers['x-deny'] ? 401 : null }));
      const base = await listen(api), path = '/api/meiji/ai/project-summary/generate';
      const url = `${base}${path}?session_id=${sid}&project_id=${project.basic_info.id}`;
      const post = (body = input, options = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Meiji-Request': '1', ...options }, body: JSON.stringify(body) });
      for (const [model, source, key] of [['codex-gpt', 'llm-server', 'ollama'], ['qwen3.5:27b', 'llm-server', 'ollama']]) {
        await runtime.models.write({ ...settings, text: { model } });
        const response = await post();
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { result: '阿明在门口找回钥匙。' });
        const call = calls.at(-1);
        assert.equal(call.source, source); assert.equal(call.auth, `Bearer ${key}`);
        assert.equal(call.path, '/v1/chat/completions'); assert.equal(call.payload.model, model);
        assert.match(call.payload.messages[1].content, /一句话概括/);
        assert.match(call.payload.messages[0].content, /不补充剧本没有写明/);
        assert.match(call.payload.messages[0].content, /输出格式/);
        assert.doesNotMatch(call.payload.messages[1].content, /输出格式/);
      }
      assert.deepEqual(stored.read(), before);
      for (const bad of [{ ...input, model: 'elysium-chat' }, { ...input, output: {} }, { ...input, script: undefined }, { ...input, language: 2 }]) assert.equal((await post(bad)).status, 422);
      assert.equal((await post(input, { 'X-Meiji-Request': '0' })).status, 403);
      assert.equal((await post(input, { Origin: 'http://elsewhere.test' })).status, 403);
      assert.equal((await post(input, { 'X-Deny': '1' })).status, 401);
      assert.equal((await fetch(`${base}${path}`, { method: 'POST', headers: { 'X-Meiji-Request': '1' }, body: JSON.stringify(input) })).status, 403);
      assert.equal((await fetch(url.replace(sid, `session-${randomUUID()}`), { method: 'POST', headers: { 'X-Meiji-Request': '1' }, body: JSON.stringify(input) })).status, 403);
      assert.equal(calls.length, 2);
    } finally {
      await runtime?.dispose();
      for (const server of [api, remote, local].filter(Boolean)) await close(server);
      await rm(home, { recursive: true, force: true });
    }
  });

  test('路由在调用模型前拒绝未声明动作与参数', async () => {
    let reads = 0, requests = 0;
    const ai = createAiRoutes({ readConfig: async () => { reads++; return config; }, gateway: { chat: async () => { requests++; return '结果'; } } });
    await assert.rejects(ai('script-split', 'unknown-action', input), /不存在/);
    await assert.rejects(ai('project-summary', 'generate', { ...input, prompt: '绕过' }), /未定义参数/);
    await assert.rejects(ai('project-summary', 'generate', { ...input, rules: [{}] }), /输入.rules/);
    assert.equal(reads, 0); assert.equal(requests, 0);
  });

  test('输出按路由契约校验，模型无法用 HTTP200 掩盖错误结构', async () => {
    const ai = createAiRoutes({ readConfig: async () => config, gateway: { chat: async () => '{"是否通过":"yes", "类型": "","原因":""}' } });
    await assert.rejects(ai('project-summary', 'review', { ...input, opinion: '', content: '候选' }), /boolean/);
    for (const [node, route] of Object.entries(nodeRoutes)) {
      for (const [action, contract] of Object.entries(route.actions)) {
        const prompt = composeNodePrompt(node, action, sampleInput(contract.input), 'elysium-chat');
        assert.deepEqual(prompt.output, contract.output);
        assert.notEqual(prompt.output, contract.output);
        if (node === 'video') assert.equal(Object.hasOwn(route, 'promptModel'), false);
        else assert.ok(!Object.hasOwn(route.promptModel[action].system, '输出格式'));
      }
    }
  });

  test('两次并发节点调用各读一次配置、保存自己的模型与提示词', async () => {
    let reads = 0, release;
    const gate = new Promise(resolve => { release = resolve; }), savedA = [], savedB = [];
    const ai = createAiRoutes({ readConfig: async () => ({ ...config, text: { model: ++reads === 1 ? 'qwen3.5:27b' : 'codex-gpt' } }), gateway: {
      chat: async ({ model, messages }) => {
      const prompt = messages.filter(message => message.role !== 'system').map(message => message.content).join('\n\n'); if (model === 'qwen3.5:27b') await gate; else release(); return prompt.includes('请求A') ? '结果A' : '结果B'; },
    } });
    const [a, b] = await Promise.all([
      ai('project-summary', 'generate', { ...input, script: '请求A' }, { record: async row => savedA.push(structuredClone(row)) }),
      ai('project-summary', 'generate', { ...input, script: '请求B' }, { record: async row => savedB.push(structuredClone(row)) }),
    ]);
    assert.equal(reads, 2); assert.equal(a.result, '结果A'); assert.equal(b.result, '结果B');
    assert.equal(a.prompt.model, 'qwen3.5:27b'); assert.equal(b.prompt.model, 'codex-gpt');
    assert.equal(savedA[0].prompt.input.script, '请求A'); assert.equal(savedB[0].prompt.input.script, '请求B');
    const userText = value => value.prompt.messages.filter(message => message.role === 'user').map(message => message.content).join('\n');
    assert.doesNotMatch(userText(a), /请求B/); assert.doesNotMatch(userText(b), /请求A/);
  });

  for (const [name, client, model, key] of [['elysium', elysiumClient, 'elysium-chat', 'test-only-secret'], ['llm-server', llmServerClient, 'qwen3.5:27b', 'ollama']]) {
    const options = { baseUrl: 'http://localhost/v1', apiKey: 'test-only-secret', model, messages: [{ role: 'system', content: '规则' }, { role: 'user', content: '生成' }] };
    test(`${name} 单例重试留痕并脱敏，400 不重试`, async () => {
      let count = 0; const traces = [];
      const result = await withGatewayTrace(async row => traces.push(row), () => client.complete({ ...options, retryDelays: [0], fetchImpl: async (_, req) => {
        assert.equal(req.headers.Authorization, `Bearer ${key}`);
        const pending = traces.at(-1);
        assert.ok(pending.request); assert.equal(Object.hasOwn(pending, 'status'), false);
        if (++count === 1) return new Response('{}', { status: 503 });
        return completion('完成');
      } }));
      assert.equal(result, '完成'); assert.equal(count, 2); assert.equal(traces.length, 4);
      assert.equal(traces[1].status, 503); assert.equal(traces[3].status, 200);
      assert.ok(!JSON.stringify(traces).includes(key));
      count = 0;
      await assert.rejects(client.complete({ ...options, retryDelays: [0], fetchImpl: async () => { count++; return new Response('{}', { status: 400 }); } }), /400/);
      assert.equal(count, 1);
    });
    test(`${name} 已取消、重试等待取消和截断响应不会返回候选`, async () => {
      const cancelled = new AbortController(); cancelled.abort(new Error('已停止'));
      let count = 0;
      await assert.rejects(client.complete({ ...options, signal: cancelled.signal, fetchImpl: async () => { count++; return completion('错误'); } }), /已停止/);
      assert.equal(count, 0);
      const controller = new AbortController();
      await assert.rejects(client.complete({ ...options, retryDelays: [5000], signal: controller.signal, fetchImpl: async () => { count++; controller.abort(); return new Response('{}', { status: 503 }); } }));
      assert.equal(count, 1);
      await assert.rejects(client.complete({ ...options, fetchImpl: async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '半截' } }] })) }), /未正常完成/);
    });
  }

  test('修订携带最新候选和对应轮次审核意见，未来/其他任务意见不混入', () => {
    const snapshot = snapshotFixture(), p = snapshot.project, shot = p.episodes[0].shot_list.shots[0];
    for (const node of ['seconds', 'storyboard']) {
      const task = taskFixture(p, node, shot.id, { opinion: '用户要求' });
      snapshot.steps = [
        { task_id: task.id, kind: 'review', step_status: 'rejected', seq: 2, result: { 原因: '本轮审核' } },
        { task_id: task.id, kind: 'review', step_status: 'rejected', seq: 8, result: { 原因: '未来审核' } },
        { task_id: 'other', kind: 'review', step_status: 'rejected', seq: 3, result: { 原因: '其他任务' } },
      ];
      const prompt = renderTaskPrompt(snapshot, task, { marker: '最新候选' }, 'regenerate', { kind: 'revise', seq: 4 });
      assert.match(prompt.messages[2].content, /最新候选/); assert.match(prompt.user, /本轮审核/); assert.match(prompt.user, /用户要求/);
      assert.doesNotMatch(prompt.user, /未来审核|其他任务/);
    }
  });

  test('分镜提示词 HTTP 执行和任务转换共用路由三段式输出格式', async () => {
    const ai = createAiRoutes({ readConfig: async () => config, gateway: { chat: async () => '只有普通文本' } });
    const request = sampleInput(nodeRoutes.storyboard.actions.generate.input);
    await assert.rejects(ai('storyboard', 'generate', request), /段落标题/);
  });

  test('直接节点请求取消后，模型晚到结果不会返回', async () => {
    const controller = new AbortController();
    const ai = createAiRoutes({ readConfig: async () => config, gateway: { chat: async () => { controller.abort(new Error('用户取消')); return '晚到候选'; } } });
    await assert.rejects(ai('project-summary', 'generate', input, { signal: controller.signal }), /用户取消/);
  });
});

describe("storyboard-language", () => {
  const sections = ['integrated_multimodal_description', 'overall_soundscape', 'non_diegetic_music'];
  const body = language => `${sections[0]}:\n[Shot 1] ${language === 'zh-CN' ? '摄影机跟随人物走到门边。' : 'The camera follows the person to the door.'} (S1) <d>你好</d>\n\n${sections[1]}:\n${language === 'zh-CN' ? '脚步声持续。' : 'Footsteps continue.'}\n\n${sections[2]}:\nN/A`;

  test('真实设置读取链将中英文选择传入分镜提示词生成、修订及审核，不改固定段名', async () => {
    const home = await mkdtemp(join(tmpdir(), 'meiji-storyboard-language-'));
    let runtime, language = 'zh-CN';
    const calls = [];
    try {
      await modelStore(home).write({ ...config, output_language: language });
      runtime = await createAppRuntime({ home, gateway: { chat: async options => {
        assert.equal(options.trace.input.language, language);
        assert.ok(options.messages[0].content.includes(`均使用${language === 'zh-CN' ? '简体中文' : 'English（英文）'}`));
        assert.doesNotMatch(options.messages[0].content, /画面描述使用英文|完整英文动作/);
        calls.push({ language, action: options.trace.action, messages: structuredClone(options.messages) });
        return options.trace.action === 'review' ? { 是否通过: true, "类型": "", 原因: '' } : body(language);
      } } });
      const project = projectFixture(), shot = project.episodes[0].shot_list.shots[0];
      const stored = await runtime.repository.create(project);
      for (const model of ['qwen3.5:27b', 'codex-gpt']) {
        for (const selected of ['zh-CN', 'en']) {
          language = selected;
          const kept = structuredClone(stored.readAll().project.episodes[0].shot_list.shots[0].text_to_video_prompt);
          await runtime.models.write({ ...config, output_language: language, text: { model } });
          assert.deepEqual(stored.readAll().project.episodes[0].shot_list.shots[0].text_to_video_prompt, kept);
          for (const action of ['regenerate', 'revise']) {
            const start = calls.length;
            const accepted = await runtime.tasks.command({ type: 'submit', project_id: project.basic_info.id,
              request_id: `${model}-${language}-${action}`, business_type: 'storyboard', target_id: shot.id,
              action, ...(action === 'revise' ? { opinion: '保持原事件，修正表达' } : {}) });
            await runtime.tasks.idle(project.basic_info.id);
            const snapshot = stored.readAll(), task = snapshot.tasks.find(t => t.id === accepted.task_id);
            assert.equal(task.task_status, 'completed', task.end_reason);
            assert.deepEqual(calls.slice(start).map(call => call.action), [action === 'revise' ? 'regenerate' : 'generate', 'review']);
            const result = snapshot.project.episodes[0].shot_list.shots[0].text_to_video_prompt;
            assert.ok(result.integrated_multimodal_description.includes(language === 'zh-CN' ? '摄影机跟随' : 'The camera follows'));
            assert.ok(result.integrated_multimodal_description.includes('<d>你好</d>'));
            assert.equal(result.non_diegetic_music, 'N/A');
          }
        }
      }
    } finally { await runtime?.dispose(); await rm(home, { recursive: true, force: true }); }
  });
});

describe("storyboard-text-context", () => {
  const resultText = 'integrated_multimodal_description:\n[Shot 1] 黑暗火场中，一只戴消防手套的手推门，画外队长说出<d>保持联系。</d>。\n\noverall_soundscape:\n警报持续。\n\nnon_diegetic_music:\nN/A';
  function fixture() {
    const snapshot = snapshotFixture(), shot = snapshot.project.episodes[0].shot_list.shots[0];
    const person = (name, number) => emptyCharacterModel({ name, number, nationality: `${name}国籍哨兵`, height: `${name}身高哨兵`, facial_features: `${name}面部哨兵`, voice: `${name}声线哨兵`,
      costume_images: [{ costume_id: '', address: `https://image-sentinel.test/${name}.png` }],
      reference_image: { address: 'data:image/png;base64,IMAGE_SENTINEL' },
    });
    const visible = person('消防员', 'C01'), voiceOnly = person('队长', 'C02'), unrelated = person('无关人物', 'C03');
    snapshot.project.character_library.characters = [visible, voiceOnly, unrelated];
    shot.on_screen_characters = [{ character_id: visible.id, costume_id: '' }];
    shot.body = '场景背景哨兵：黑暗火场。摄影安排哨兵：固定特写，仅手及袖口入镜。';
    shot.reference_anchor.fixed_landmark = '门框位置哨兵';
    shot.seconds_storyboard.storyboard[0].dialogue = [{ speaker_id: voiceOnly.id, speaker_name: '队长别称', mode: '画外', dialogue_text: '保持联系。' }];
    return { snapshot, shot, visible, voiceOnly, unrelated };
  }

  test('文本提示词实际HTTP消息含整镜设定和出镜/发声人物文字，两个来源三动作均不带图', async () => {
    let action, received = 0;
    const server = createServer(async (req, res) => {
      let raw = ''; for await (const chunk of req) raw += chunk;
      try {
        assert.equal(req.method, 'POST');
        assert.equal(req.url, '/v1/chat/completions');
        const body = JSON.parse(raw);
        assert.ok(body.messages.every(message => typeof message.content === 'string'));
        const prompt = body.messages.map(message => message.content).join('\n');
        for (const marker of ['场景背景哨兵', '摄影安排哨兵', '门框位置哨兵', '消防员国籍哨兵', '消防员身高哨兵', '消防员面部哨兵', '队长声线哨兵', '保持联系。']) assert.ok(prompt.includes(marker), marker);
        assert.doesNotMatch(prompt, /无关人物|image-sentinel|IMAGE_SENTINEL|data:image|image_url|reference_image|costume_images/);
        assert.match(prompt, /本节点仅生成文本提示词/);
        assert.match(prompt, /只有画外声时写明为画外声/);
        received++;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: action === 'review' ? '{"是否通过":true, "类型": "","原因":""}' : resultText } }] }));
      } catch (error) { res.writeHead(500); res.end(JSON.stringify({ message: error.message })); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const { snapshot, shot } = fixture(), task = taskFixture(snapshot.project, 'storyboard', shot.id);
      const saved = structuredClone(snapshot.project);
      for (const model of ['qwen3.5:27b', 'codex-gpt']) {
        const ai = createAiRoutes({ readConfig: async () => ({ ...config, textBaseUrl: `http://127.0.0.1:${server.address().port}/v1`, text: { model } }) });
        for (action of ['generate', 'regenerate', 'review']) {
          const input = taskNodeInput(snapshot, task, resultText, action);
          const response = await ai('storyboard', action, input);
          assert.deepEqual(input.characters.map(person => person.name), ['消防员', '队长']);
          assert.deepEqual(response.result, action === 'review' ? { 是否通过: true, "类型": "", 原因: '' } : resultText);
        }
      }
      assert.equal(received, 6);
      assert.deepEqual(snapshot.project, saved);
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  });

  test('参与角色外貌文字影响最终提示词指纹，图片及无关人物不影响，前置目录也携带完整外貌', () => {
    const { snapshot, shot, visible, unrelated } = fixture();
    const hash = () => dependencyHash(snapshot, 'storyboard', shot.id);
    const before = hash();
    visible.reference_image.address = 'other-image.png'; unrelated.facial_features = '无关改动';
    assert.equal(hash(), before);
    visible.facial_features = '新面部特征'; assert.notEqual(hash(), before);
    const task = taskFixture(snapshot.project, 'seconds', shot.id);
    const input = taskNodeInput(snapshot, task, null, 'generate');
    assert.equal(input.characters.find(person => person.id === visible.id).facial_features, '新面部特征');
  });

  test('同一说话人在不同镜头子集及目录重排后使用同一标记，标记进入实际提示词', async () => {
    const { snapshot, shot, visible, voiceOnly } = fixture();
    const { shotTextInputs } = await import('../shared/shot-text-inputs.js');
    const { composeNodePrompt } = await import('../server/http/ai-routes.js');
    const episode = snapshot.project.episodes[0];
    const input = shotTextInputs(snapshot.project, episode, shot, 'storyboard');
    const tags = new Map(input.characters.map(person => [person.id, person.speaker_tag]));
    assert.match(tags.get(visible.id), /^\(S\d+\)$/);
    assert.notEqual(tags.get(visible.id), tags.get(voiceOnly.id));
    const next = structuredClone(shot);
    next.on_screen_characters = [{ character_id: voiceOnly.id, costume_id: '' }];
    next.seconds_storyboard.storyboard.forEach(beat => { beat.dialogue = []; });
    const nextInput = () => shotTextInputs(snapshot.project, episode, next, 'storyboard');
    assert.deepEqual(nextInput().characters.map(person => [person.id, person.speaker_tag]), [[voiceOnly.id, tags.get(voiceOnly.id)]]);
    snapshot.project.character_library.characters.reverse();
    assert.deepEqual(nextInput().characters.map(person => [person.id, person.speaker_tag]), [[voiceOnly.id, tags.get(voiceOnly.id)]]);
    for (const model of ['qwen3.5:27b', 'codex-gpt']) {
      const prompt = composeNodePrompt('storyboard', 'generate', { ...nextInput(), language: 'zh-CN', requirements: '' }, model);
      assert.ok(prompt.user.includes(tags.get(voiceOnly.id)));
      assert.ok(prompt.system.includes('不得按本镜出场顺序重新编号'));
    }
  });
});

describe("review-candidate", () => {
  for (const model of ['qwen3.5:27b', 'codex-gpt']) test(`${model}审核保留完整候选JSON，空字段与台词不丢失或二次展开`, () => {
    const candidate = {
      end_state: '人物站在门边。', pending_actions: '', pending_dialogue: '', continuing_audio: '',
      storyboard: [{ time_range: '0–1s', action: '人物看向门外。', camera: '', space: '', audio: '', handoff: '', dialogue: [] }],
      evidence: { absent: null, empty: {}, quoted: '他说：“{{不要解释}}”。\n第二行\\原文' },
    };
    const input = { ...sampleInput(seconds.actions.review.input), previous: null, content: candidate };
    const before = structuredClone(input);
    const prompt = composeNodePrompt('seconds', 'review', input, model);
    const data = prompt.user.split('# 待审核内容\n')[1].split(/\n\n# /)[0];
    assert.deepEqual(JSON.parse(data), candidate);
    assert.deepEqual(input, before);
    assert.equal(prompt.messages[0].role, model === 'codex-gpt' ? 'developer' : 'system');
  });
});

describe("prompt-chain", () => {
  const line = (speaker_name, mode, dialogue_text, speaker_id = '') => ({ speaker_id, speaker_name, mode, dialogue_text });

  test('同人画内转画外不切断一句，完整句可跨拍合并', () => {
    const node = { storyboard: [{ dialogue: [line('甲', '画内', '我还有')] }, { dialogue: [line('甲', '画外', '话说。')] }] };
    assert.throws(() => assertPromptDialogue(node, '(S1)<d>我还有</d>声音转画外。<d>话说。</d>'), error => error.validationKind === 'dialogue-preservation');
    assert.doesNotThrow(() => assertPromptDialogue(node, '声音由画内转画外，(S1)<d>我还有话说。</d>'));
  });

  test('一个标签不得跨人物，分别完整标记允许被打断的本镜原话', () => {
    for (const ids of [false, true]) {
      const node = { storyboard: [{ dialogue: [line('甲', '画内', '可是我', ids ? 'a' : ''), line('乙', '画内', '别说了！', ids ? 'b' : '')] }] };
      assert.throws(() => assertPromptDialogue(node, '<d>可是我别说了！</d>'), /不同说话人/);
      assert.doesNotThrow(() => assertPromptDialogue(node, '(S1)<d>可是我</d>(S2)<d>别说了！</d>'));
    }
  });

  test('人工放行也拦截画内外切换导致的一句碎片', () => {
    const p = projectFixture(), shot = p.episodes[0].shot_list.shots[0];
    shot.seconds_storyboard.storyboard = ['0–2s','2–5s'].map((time_range, index) => ({ ...emptyStoryboardBeatModel(), time_range, action: '同一句持续说完', dialogue: [line('甲', index ? '画外' : '画内', index ? '话说。' : '我还有')] }));
    shot.text_to_video_prompt.integrated_multimodal_description = '[Shot 1] <d>我还有</d>转画外。<d>话说。</d>';
    assert.throws(() => assertOverride(p, 'storyboard', shot.id), /拆开了一句/);
    shot.text_to_video_prompt.integrated_multimodal_description = '[Shot 1] <d>我还有话说。</d>';
    assert.doesNotThrow(() => assertOverride(p, 'storyboard', shot.id));
  });

  test('心声与实际发声保留各自通道，不因同一人物而误合并', () => {
    const node = { storyboard: [{ dialogue: [line('甲', '心声', '怎么会'), line('甲', '画外', '别走！')] }] };
    assert.doesNotThrow(() => assertPromptDialogue(node, '甲心声<d>怎么会</d>，随后出声<d>别走！</d>'));
    assert.throws(() => assertPromptDialogue(node, '<d>怎么会别走！</d>'), /心声\/实际发声通道/);
  });

  test('审核分类来源限定为本节点输入，位置与原文依据统一写在原因里', () => {
    const seconds = composeNodePrompt('seconds', 'review', nodeInput('seconds', 'review'), 'codex-gpt');
    const text = composeNodePrompt('storyboard', 'review', nodeInput('storyboard', 'review'), 'codex-gpt');
    assert.match(seconds.system, /上游资料来源只能为本次输入的镜头表、前镜交接、角色资料/);
    assert.match(text.system, /上游资料来源只能为本次输入的节拍分镜、镜头表、角色资料/);
    for (const prompt of [seconds, text]) {
      assert.match(prompt.system, /原因须指明来源、位置并引用该来源中真实的连续原文/);
      assert.deepEqual(prompt.output.structure, { 是否通过: true, 类型: '', 原因: '' });
      assert.equal(prompt.output.optionalStructure, undefined);
    }
  });

  function nodeInput(node, action) {
    const p = projectFixture(), ep = p.episodes[0], shot = ep.shot_list.shots[0];
    if (node === 'scene-image') return {language:'zh-CN',requirements:'',scene:{name:'客厅'},aspectRatio:'9:16',references:[],...(action === 'regenerate' ? {opinion:'保留布局'} : {})};
    if (node === 'costume-image') return { language: 'zh-CN', requirements: '', person: '人物甲', costume: '蓝衣', referenceDescription: '', aspectRatio: '9:16', references: [], ...(action === 'regenerate' ? { opinion: '保持身份' } : {}) };
    if (node === 'video') return { type: '文生', textPrompt: { integrated_multimodal_description: '人物静立', overall_soundscape: '风声', non_diegetic_music: 'N/A' }, duration: 5, aspectRatio: '9:16', ...(action === 'regenerate' ? { opinion: '保持动作' } : {}) };
    const target = ['project-summary','project-characters','script-review','script-split'].includes(node) ? p.basic_info.id : ['outline','shots','episode-summary','episode-scenes'].includes(node) ? ep.id : shot.id;
    return taskNodeInput({ project: p, tasks: [], steps: [] }, { id: 'audit', business_type: node, target_id: target, opinion: '保持原话与动作' }, null, action);
  }

  test('全部节点和动作共用两种来源的渲染、输出契约及消息边界检查', () => {
    for (const model of ['qwen3.5:27b', 'codex-gpt']) {
      for (const [node, route] of Object.entries(nodeRoutes)) {
        for (const [action, contract] of Object.entries(route.actions)) {
          const input = nodeInput(node, action);
          const prompt = composeNodePrompt(node, action, input, model);
          const label = `${model}/${node}/${action}`;
          assert.ok(prompt.user, label);
          assert.deepEqual(prompt.output, contract.output, label);
          assert.throws(() => composeNodePrompt(node, action, {}, model), /输入/, label);
          assert.doesNotMatch(prompt.body, /\{\{[^{}]+\}\}/, label);
          assert.equal(prompt.user.includes('# 输出格式'), false, label);
          if (node === 'video') {
            assert.equal(prompt.system, '', label);
            assert.equal(Object.hasOwn(route, 'promptModel'), false, label);
            assert.equal(prompt.body, prompt.user, label);
          } else {
            assert.ok(prompt.system, label);
            assert.equal(Object.hasOwn(route.promptModel[action].system, '输出格式'), false, label);
            assert.equal(prompt.body, prompt.messages.map(message => message.content).join('\n\n'), label);
          }
          if (['JSON', '文本'].includes(contract.output.type)) {
            assert.equal(prompt.messages[0].role, model === 'codex-gpt' ? 'developer' : 'system', label);
            assert.match(prompt.system, /# 响应约定/, label);
            assert.doesNotMatch(prompt.system, /\/nothink/, label);
          } else assert.equal(prompt.body.includes('# 响应约定'), false, label);
          if (action === 'review') {
            assert.equal((prompt.system.match(/审核只返回是否通过、类型、原因三个字段/g) || []).length, 1, label);
          }
        }
      }
    }
  });

  test('生成修订审核共用节拍、对白字段和摄影边界，不要求额外表演字段', () => {
    for (const action of ['generate','regenerate','review']) {
      const { system } = composeNodePrompt('seconds', action, nodeInput('seconds', action), 'codex-gpt');
      assert.match(system, /普通短动作.*亚秒/); assert.match(system, /持续状态.*跨多秒/);
      assert.doesNotMatch(system, /每个节拍固定1秒|每个节拍为1秒|一般为1–4秒|仅钩子|只有钩子|自主摄影|由本阶段设计|写对白表演/);
      assert.match(system, /dialogue_text只保存实际可听见的原话/);
      assert.match(system, /不新增表演、performance/);
      assert.match(system, /不重新选择整镜背景/);
    }
  });

  test('普通亚秒节拍及跨多秒持续节拍通过程序审核，时间线仍需精确覆盖', () => {
    const p = projectFixture(), shot = p.episodes[0].shot_list.shots[0];
    shot.hook = '温情';
    shot.seconds_storyboard.storyboard = ['0–0.2s','0.2–5s'].map(time_range => ({ ...emptyStoryboardBeatModel(), time_range, action: '主要动作或持续状态' }));
    assert.doesNotThrow(() => assertProgramReview(p, 'seconds', shot.id));
    shot.seconds_storyboard.storyboard[1].time_range = '0.2–4.9s';
    assert.throws(() => assertProgramReview(p, 'seconds', shot.id), /需等于本镜参考/);
  });

  test('大纲重复保存和人工放行不抬高固定参考，无法滚动增加30秒', () => {
    const s = snapshotFixture(), ep = s.project.episodes[0]; ep.duration_seconds = 180;
    const content = { segments: [{ sequence: 1, duration_seconds: 210, body: '完整原剧情', causal: '' }] };
    for (const action of ['regenerate','manual_edit','override']) {
      ep.story_outline.segments = structuredClone(content.segments);
      assert.doesNotThrow(() => assertProgramReview(s.project, 'outline', ep.id));
      commitContent(s, taskFixture(s.project, 'outline', ep.id, { action }), content);
      assert.equal(ep.duration_seconds, 180);
      const next = taskNodeInput(s, taskFixture(s.project, 'outline', ep.id), null, 'generate');
      assert.equal(next.duration, 180);
    }
    ep.story_outline.segments[0].duration_seconds = 240;
    assert.throws(() => assertOverride(s.project, 'outline', ep.id), /超出允许范围/);
  });

  test('镜头表容差与固定集预算取交集，180→210→240不再合法', () => {
    const p = projectFixture(), ep = p.episodes[0], template = ep.shot_list.shots[0];
    ep.duration_seconds = 180; ep.story_outline.segments[0].duration_seconds = 210;
    const budget = shotsBudget(ep.story_outline.segments, ep.duration_seconds);
    assert.equal(budget.target_seconds, 210); assert.equal(budget.min_seconds, 180); assert.equal(budget.max_seconds, 210);
    ep.shot_list.shots = Array.from({ length: 16 }, (_,i) => ({ ...structuredClone(template), id: createId('shot'), sequence: i + 1, number: `S${i + 1}`, duration_seconds: 15 }));
    assert.throws(() => assertProgramReview(p, 'shots', ep.id), /固定集预算/);
    ep.shot_list.shots.splice(14);
    assert.doesNotThrow(() => assertProgramReview(p, 'shots', ep.id));
  });

  test('上游大纲预算已不合法时，在配置和模型请求前停止镜头任务', async () => {
    let reads = 0;
    const ai = createAiRoutes({ readConfig: async () => { reads++; throw Error('不应读取配置'); } });
    const input = nodeInput('shots', 'generate');
    input.duration = 180;
    input.segments[0].duration_seconds = 240;
    await assert.rejects(ai('shots', 'generate', input), /上游分集改编.*先修正大纲/);
    assert.equal(reads, 0);
  });
});


test('提示词首段标记和首段时间戳由生成校验及人工放行共同核验', () => {
  const project = projectFixture(), shot = project.episodes[0].shot_list.shots[0];
  const raw = text => `integrated_multimodal_description\n${text}\noverall_soundscape\n风声。\nnon_diegetic_music\nN/A`;
  const input = { storyboard: shot.seconds_storyboard };
  const valid = '[Shot 1] 人物站立，机位固定。';
  assert.doesNotThrow(() => validateNodeResult('storyboard', 'generate', raw(valid), input));
  for (const text of ['人物站立。', '[Shot 2] 人物站立。', '[Shot 1] At 00:00.000 人物站立。']) {
    assert.throws(() => validateNodeResult('storyboard', 'generate', raw(text), input), /首段|时间戳/);
    shot.text_to_video_prompt.integrated_multimodal_description = text;
    assert.throws(() => assertOverride(project, 'storyboard', shot.id), /首段|时间戳/);
  }
});
