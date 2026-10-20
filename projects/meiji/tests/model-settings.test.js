import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { defaults, normalizeModels, modelRoute } from "../models/model-config.js";
import { modelStore } from "../server/data/model-settings.js";
import { migrateSettingsModel } from "../scripts/migrate-settings-model.js";
import { syncChatModel } from "../server/host/harness-chat-model.js";
import { createAiRoutes } from "../server/http/ai-routes.js";
import { createAppRuntime } from "../server/runtime/app-runtime.js";
import { createTaskHttpHandler } from "../server/http/task-routes.js";
import { emptyProject } from "../shared/project_contract.js";
import { modelOptions } from "../shared/models/settings_model.js";
import { SettingsModel } from "../models/settings-model.js";
import { chatParameters, imageParameters, gptImagePrompt } from "../server/http/llm-server/params.js";
import { renderPrompt } from "../server/prompts/render.js";
import { textProvider } from "../server/prompts/providers.js";

describe("qwen", () => {
  const config = {
    baseUrl: 'https://media.test/v1', apiKey: 'media-secret',
    textBaseUrl: 'http://127.0.0.1:11435/v1',
    text: { model: 'qwen3.5:27b' },
    image: { model: 'gpt-image' }, video: { model: 'elysium-video' },
    output_language: 'zh-CN',
  }

  test('千问：文本路由和媒体凭据隔离，配置保存不丢失独立地址', async () => {
    const base = await defaults(new URL('./fixtures/absent-local.json', import.meta.url))
    assert.equal(base.session.model, 'codex-gpt')
    assert.equal(base.text.model, 'qwen3.5:27b')
    assert.equal(base.image.model, 'krea2 turbo V2.5')
    const normalized = normalizeModels(config)
    assert.deepEqual(modelRoute(normalized, 'story'), { baseUrl: config.textBaseUrl, apiKey: 'ollama', model: 'qwen3.5:27b' })
    assert.deepEqual(modelRoute(normalized, 'chat'), { baseUrl: config.textBaseUrl, apiKey: 'ollama', model: 'codex-gpt' })
    assert.deepEqual(modelRoute(normalized, 'image'), { baseUrl: config.textBaseUrl, apiKey: 'ollama', model: 'gpt-image' })
    assert.deepEqual(modelRoute(normalized, 'video'), { baseUrl: config.textBaseUrl, apiKey: 'ollama', model: 'MiniMax-H3' })
    assert.deepEqual(normalized, { ...config, session: { model: 'codex-gpt' }, video: { model: 'MiniMax-H3' } })
    assert.throws(() => normalizeModels({ ...config, textBaseUrl: '' }), /网关地址无效/)
    assert.equal(modelRoute({ ...config, apiKey: '' }, 'story').apiKey, 'ollama')
  })

  test('当前文本、图片和视频均通过本机服务，无旧媒体地址或密钥也可配置', () => {
    const { apiKey, baseUrl, ...serverOnly } = config
    const normalized = normalizeModels(serverOnly)
    assert.equal(normalized.apiKey, '')
    for (const purpose of ['text', 'image', 'video']) {
      const route = modelRoute(normalized, purpose)
      assert.equal(route.baseUrl, config.textBaseUrl)
      assert.equal(route.apiKey, 'ollama', '仅为协议占位值，不是供应商密钥')
    }
    assert.equal(normalizeModels({ ...config, apiKey: '' }).apiKey, '')
  })

  test('千问：显式迁移先备份，媒体、额外设置及原备份不变，重复执行不重写', async () => {
    const home = await mkdtemp(join(tmpdir(), 'meiji-qwen-migration-'))
    try {
      const previous = { ...config, text: undefined, textBaseUrl: undefined, chat: { model: 'qwen3.5:27b' }, story: { model: 'qwen3.5:27b' }, concurrency: { text: 4, image: 2, video: 2 } }
      const store = modelStore(home)
      await store.write(previous)
      const before = await readFile(join(home, 'storages/meiji/models.json'), 'utf8')
      const migrated = await migrateSettingsModel(home)
      assert.equal(migrated.changed, true)
      assert.equal(await readFile(migrated.backup, 'utf8'), before)
      const after = await store.read()
      for (const key of ['baseUrl', 'apiKey', 'image', 'concurrency']) assert.deepEqual(after[key], previous[key])
      assert.equal(after.video.model, 'MiniMax-H3')
      assert.equal(after.session.model, 'codex-gpt')
      assert.equal(after.text.model, 'qwen3.5:27b')
      assert.equal(after.chat, undefined)
      assert.equal(after.story, undefined)
      assert.equal(after.textBaseUrl, config.textBaseUrl)
      assert.equal(after.output_language, 'zh-CN')
      assert.deepEqual(await migrateSettingsModel(home), { changed: false })
      assert.equal(await readFile(migrated.backup, 'utf8'), before)
    } finally { await rm(home, { recursive: true, force: true }) }
  })

  test('迁移把已移除的 elysium 文本与图片选择改为默认可选值，保留连接与额外设置', async () => {
    const home = await mkdtemp(join(tmpdir(), 'meiji-fixed-options-'))
    try {
      const previous = { baseUrl: config.baseUrl, apiKey: config.apiKey, chat: { model: 'elysium-chat' }, story: { model: 'elysium-chat' }, image: { model: 'elysium-image' }, video: { model: 'elysium-video' }, concurrency: { text: 4 } }
      const store = modelStore(home)
      await store.write(previous)
      const migrated = await migrateSettingsModel(home)
      assert.equal(migrated.changed, true)
      const after = await store.read()
      assert.equal(after.session.model, 'codex-gpt')
      assert.equal(after.text.model, 'qwen3.5:27b')
      assert.equal(after.image.model, 'krea2 turbo V2.5')
      assert.equal(after.video.model, 'MiniMax-H3')
      assert.equal(after.output_language, 'zh-CN')
      for (const key of ['baseUrl', 'apiKey', 'concurrency']) assert.deepEqual(after[key], previous[key])
      assert.equal(after.chat, undefined)
      assert.equal(after.story, undefined)
      await store.write({ ...after, text: { model: 'elysium-chat' } })
      assert.equal((await migrateSettingsModel(home)).changed, true)
      assert.equal((await store.read()).text.model, 'qwen3.5:27b')
      assert.deepEqual(await migrateSettingsModel(home), { changed: false })
    } finally { await rm(home, { recursive: true, force: true }) }
  })

  test('千问：聊天通过公开服务同步，不依赖媒体密钥，正确声明容量和思考开关', async () => {
    const calls = []
    await syncChatModel({
      settings: { mutate: () => assert.fail('默认会话模型不切换工具会话'), update: () => assert.fail() },
      credentials: { set: () => assert.fail() },
    }, { ...config, apiKey: '' })
    await syncChatModel({
      credentials: { set: async (...args) => calls.push(['credential', ...args]) },
      settings: { mutate: async (...args) => calls.push(['mutate', ...args]), update: async (...args) => calls.push(['update', ...args]) },
    }, { ...config, apiKey: '', session: { model: 'qwen3.5:27b' } })
    assert.deepEqual(calls[0], ['credential', 'MEIJI_GATEWAY_API_KEY', 'ollama'])
    const provider = calls[1][2][0].value
    assert.equal(provider.baseURL, config.textBaseUrl)
    assert.equal(provider.reasoning, 'off')
    assert.equal(provider.compat.supportsDeveloperRole, false)
    assert.equal(provider.compat.requiresThinkingAsText, false)
    assert.equal(provider.models[0].contextWindow, 262144)
    assert.equal(provider.models[0].maxTokens, undefined)
    assert.deepEqual(provider.models[0].reasoningEfforts, { off: 'none', medium: 'medium' })
    assert.deepEqual(calls[2], ['update', 'agent-default-model', { provider: 'meiji-gateway', model: 'qwen3.5:27b', reasoningEffort: 'off' }])
    assert.ok(!JSON.stringify(calls).includes(config.apiKey))
  })

  test('千问：真实 runtime 经独立文本 HTTP 完成生成、审核及修订；设置 API 保留媒体密钥', async () => {
    const home = await mkdtemp(join(tmpdir(), 'meiji-qwen-runtime-'))
    const requests = []
    let runtime, api, reviews = 0
    const modelServer = createServer(async (req, res) => {
      let data = ''
      for await (const chunk of req) data += chunk
      const body = JSON.parse(data)
      requests.push({ url: req.url, authorization: req.headers.authorization, body })
      const review = body.messages[1].content.includes('审核当前目标')
      const content = review ? JSON.stringify({ 是否通过: ++reviews > 1, "类型": (reviews > 1) ? "" : "模型问题", 原因: reviews === 1 ? '摘要需要保留结局' : '' }) : '小林找回丢失的钥匙。'
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content, reasoning: '不进入下一轮提示' } }] }))
    })
    await new Promise(resolve => modelServer.listen(0, '127.0.0.1', resolve))
    try {
      const local = { ...config, textBaseUrl: `http://127.0.0.1:${modelServer.address().port}/v1` }
      await modelStore(home).write(local)
      runtime = await createAppRuntime({ home })
      api = createServer(createTaskHttpHandler(runtime, { authorize: () => null }))
      await new Promise(resolve => api.listen(0, '127.0.0.1', resolve))
      const url = `http://127.0.0.1:${api.address().port}/api/meiji/models`
      const get = await (await fetch(url)).json()
      assert.deepEqual(get.settings, { output_language: 'zh-CN', session: { model: 'codex-gpt' }, text: config.text, image: config.image, video: { model: 'MiniMax-H3' } })
      assert.ok(!JSON.stringify(get).includes(config.apiKey))
      const saved = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Meiji-Request': '1' }, body: JSON.stringify({ settings: get.settings }) })
      assert.equal(saved.status, 200)
      assert.deepEqual(await runtime.models.read(), { ...local, session: { model: 'codex-gpt' }, video: { model: 'MiniMax-H3' } })
      const p = emptyProject({ basic_info: { name: '连接测试', creation_mode: '剧本' } })
      p.script_revision.body = '小林丢了钥匙，回到公园长椅旁，找回了钥匙。'
      const model = await runtime.repository.create(p)
      const submitted = await runtime.tasks.command({ type: 'submit', project_id: p.basic_info.id, request_id: 'qwen', business_type: 'project-summary', target_id: p.basic_info.id, action: 'generate' })
      await runtime.tasks.idle(p.basic_info.id)
      const task = model.readAll().tasks.find(t => t.id === submitted.task_id)
      assert.equal(task.task_status, 'completed', task.end_reason)
      assert.equal(requests.length, 4)
      for (const request of requests) {
        assert.equal(request.url, '/v1/chat/completions')
        assert.equal(request.authorization, 'Bearer ollama')
        assert.equal(request.body.model, 'qwen3.5:27b')
        for (const key of ['reasoning_effort', 'temperature', 'top_p', 'presence_penalty']) assert.equal(request.body[key], undefined)
        assert.equal(request.body.max_tokens, undefined)
        assert.ok(!JSON.stringify(request).includes('不进入下一轮提示'))
      }
      assert.match(requests[2].body.messages.at(-1).content, /摘要需要保留结局/)
    } finally {
      await runtime?.dispose()
      for (const server of [api, modelServer].filter(Boolean)) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
      await rm(home, { recursive: true, force: true })
    }
  })
});

describe("settings", () => {
  const selection = { output_language: 'zh-CN', session: { model: 'codex-gpt' }, text: { model: 'qwen3.5:27b' }, image: { model: 'gpt-image' }, video: { model: 'MiniMax-H3' } }
  const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}/v1`)))

  test('设置 Model 拒绝未知选项、图片冒用文本，会话与制作文本分开', () => {
    assert.throws(() => new SettingsModel({ ...selection, text: { model: 'unknown' } }), /请选择有效模型/)
    assert.throws(() => new SettingsModel({ ...selection, image: selection.text }), /请选择有效模型/)
    const config = { ...selection, baseUrl: 'https://gateway.test/v1', textBaseUrl: 'http://localhost:11435/v1', apiKey: 'private' }
    assert.equal(modelRoute(config, 'chat').model, 'codex-gpt')
    assert.equal(modelRoute(config, 'story').model, config.text.model)
    assert.notEqual(modelRoute(config, 'chat').model, modelRoute(config, 'story').model)
    for (const [purpose, model] of [['text', 'elysium-chat'], ['image', 'elysium-image']]) {
      assert.throws(() => new SettingsModel({ ...selection, [purpose]: { model } }), /请选择有效模型/)
    }
    assert.equal(new SettingsModel({ ...selection, video: { model: 'elysium-video' } }).video.model, 'MiniMax-H3')
    assert.equal(modelRoute(config, 'video').model, 'MiniMax-H3')
    assert.equal(modelRoute(config, 'video').baseUrl, 'http://localhost:11435/v1')
    assert.equal(modelRoute(config, 'video').apiKey, 'ollama')
    const gpt = modelRoute(config, 'image')
    assert.equal(gpt.model, 'gpt-image')
    assert.equal(gpt.baseUrl, 'http://localhost:11435/v1')
    assert.equal(gpt.apiKey, 'ollama')
    assert.equal(modelRoute(config, 'chat').baseUrl, 'http://localhost:11435/v1')
  })

  test('设置 API 切换后下一次制作使用对应 HTTP、凭据与参数，重建 runtime 恢复选项', async () => {
    const home = await mkdtemp(join(tmpdir(), 'meiji-settings-'))
    const requests = []
    const server = kind => createServer(async (req, res) => {
      let raw = ''; for await (const chunk of req) raw += chunk
      const body = JSON.parse(raw)
      requests.push({ kind, path: req.url, authorization: req.headers.authorization, body })
      const content = body.messages[1].content.includes('审核当前目标') ? JSON.stringify({ 是否通过: true, "类型": "", 原因: '' }) : '阿明找回了失落的钥匙。'
      res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }))
    })
    const remote = server('gateway'), local = server('qwen')
    let runtime, api
    try {
      const config = { ...selection, baseUrl: await listen(remote), textBaseUrl: await listen(local), apiKey: 'gateway-secret', concurrency: { text: 4 } }
      await modelStore(home).write(config)
      runtime = await createAppRuntime({ home })
      const synced = []
      runtime.syncModels = value => syncChatModel({ credentials: { set: async (_, key) => synced.push(key) }, settings: { mutate: async (_, ops) => synced.push(ops[0].value), update: async () => {} } }, value)
      api = createServer(createTaskHttpHandler(runtime))
      const url = (await listen(api)).replace('/v1', '/api/meiji/models')
      const save = settings => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Meiji-Request': '1' }, body: JSON.stringify({ settings }) })
      const publicConfig = await (await fetch(url)).json()
      assert.deepEqual(publicConfig.settings, selection)
      let project
      for (const [modelName, kind, key] of [['qwen3.5:27b', 'qwen', 'ollama'], ['codex-gpt', 'qwen', 'ollama']]) {
        const before = requests.length
        const response = await save({ ...selection, text: { model: modelName }, apiKey: 'must-not-overwrite', baseUrl: 'http://must-not-use.test' })
        assert.equal(response.status, 200)
        assert.equal(synced.length, 0, '切换文本模型不改变会话模型')
        const p = emptyProject({ basic_info: { name: 'HTTP验证', creation_mode: '剧本' } }); p.script_revision.body = '阿明丢失钥匙，寻找后找回。'
        project = await runtime.repository.create(p)
        const submitted = await runtime.tasks.command({ type: 'submit', project_id: p.basic_info.id, request_id: modelName, business_type: 'project-summary', target_id: p.basic_info.id, action: 'generate' })
        await runtime.tasks.idle(p.basic_info.id)
        const task = project.readAll().tasks.find(t => t.id === submitted.task_id)
        assert.equal(task.task_status, 'completed', task.end_reason)
        assert.equal(requests.length - before, 2)
        for (const req of requests.slice(before)) {
          assert.equal(req.kind, kind); assert.equal(req.path, '/v1/chat/completions')
          assert.equal(req.authorization, `Bearer ${key}`); assert.equal(req.body.model, modelName)
          assert.equal(req.body.reasoning_effort, undefined) // Qwen 默认参数由 llm-server 补齐
        }
      }
      const sessionSave = await save({ ...selection, text: { model: 'codex-gpt' }, session: { model: 'qwen3.5:27b' } })
      assert.equal(sessionSave.status, 200)
      assert.equal(synced.at(-2), 'ollama')
      assert.equal(synced.at(-1).models[0].contextWindow, 262144)
      assert.equal((await runtime.models.read()).text.model, 'codex-gpt')
      assert.equal((await runtime.models.read()).session.model, 'qwen3.5:27b')
      const kept = project.readAll().project.project_summary.body
      assert.equal((await save({ ...selection, output_language: 'en' })).status, 200)
      assert.equal(project.readAll().project.project_summary.body, kept)
      assert.equal(Object.hasOwn(project.readAll().project, 'output_language'), false)
      const fresh = emptyProject({ basic_info: { name: '语言验证', creation_mode: '剧本' } }); fresh.script_revision.body = '阿明丢失钥匙，寻找后找回。'
      await runtime.repository.create(fresh)
      const beforeLanguage = requests.length
      await runtime.tasks.command({ type: 'submit', project_id: fresh.basic_info.id, request_id: 'lang', business_type: 'project-summary', target_id: fresh.basic_info.id, action: 'generate' })
      await runtime.tasks.idle(fresh.basic_info.id)
      const languageCalls = requests.slice(beforeLanguage).map(item => JSON.stringify(item.body)).join('\n')
      assert.match(languageCalls, /English（英文）/)
      assert.doesNotMatch(languageCalls, /简体中文/)
      const persisted = await runtime.models.read()
      assert.deepEqual(persisted.concurrency, { text: 4 })
      assert.equal(persisted.apiKey, 'gateway-secret')
      for (const bad of [{ text: { model: 'bad' } }, { text: { model: 'elysium-chat' } }, { image: { model: 'elysium-image' } }]) {
        assert.equal((await save({ ...selection, ...bad })).status, 400)
      }
      runtime.syncModels = async () => { throw Error('聊天同步失败') }
      assert.equal((await save({ ...selection, text: { model: 'qwen3.5:27b' } })).status, 422)
      assert.deepEqual(await runtime.models.read(), persisted)
      await runtime.dispose(); runtime = await createAppRuntime({ home })
      assert.deepEqual(await runtime.models.read(), persisted)
    } finally {
      await runtime?.dispose()
      for (const s of [api, remote, local].filter(Boolean)) { s.closeAllConnections(); await new Promise(resolve => s.close(resolve)) }
      await rm(home, { recursive: true, force: true })
    }
  })
});

describe("codex", () => {
  const settings = { text: { model: 'codex-gpt' }, image: { model: 'gpt-image' }, video: { model: 'elysium-video' }, baseUrl: 'https://gateway.test/v1', textBaseUrl: 'http://localhost:11435/v1', apiKey: 'private-media-key' };
  test('GPT设置、路由与制作HTTP使用本地桥接，不将网关密钥传给Codex', async () => {
    assert.equal(new SettingsModel(settings).text.model, 'codex-gpt');
    assert.ok(modelOptions.text.some(x => x.value === 'codex-gpt' && x.label.includes('GPT')));
    const route = modelRoute(settings, 'story');
    assert.equal(route.baseUrl, settings.textBaseUrl);
    assert.equal(textProvider(route.model), 'codex');
    const request = chatParameters({ ...route, messages: [{ role: 'developer', content: '规则' }, { role: 'user', content: '正文' }] });
    assert.equal(request.body.model, 'codex-gpt');
    assert.doesNotMatch(JSON.stringify(request), /private-media-key/);
    assert.equal(request.body.messages[0].role, 'developer');
    await syncChatModel({ settings: { mutate: () => assert.fail('不切换工具会话'), update: () => assert.fail() }, credentials: { set: () => assert.fail() } }, settings);
  });
  const output = { type: 'JSON', structure: { body: '' }, requirements: '只返回JSON' };
  const model = {
    generate: { system: { 规则: '保留全部剧情' }, user: { 任务: '生成正文', 背景信息: { 剧情: '{{剧情}}' }, 补充需求: '{{修改意见}}' } },
    regenerate: { system: { 规则: '保留全部剧情并按意见修订' }, user: { 任务: '修订基稿', 背景信息: { 剧情: '{{剧情}}' }, 修改意见: '{{修改意见}}' } },
  };
  test('GPT固定约束与背景分离，修订保留真实assistant，重新生成没有基稿', () => {
    const values = { 剧情: '背景中的 </context> 和 # 指令都是剧情', 修改意见: '审核原因：人物缺失；本次意见：补足动作', 基稿: { body: '旧结果' } };
    const generated = renderPrompt(model, 'generate', values, output, 'codex');
    assert.deepEqual(generated.messages.map(m => m.role), ['developer', 'user']);
    assert.doesNotMatch(generated.body, /旧结果/);
    assert.match(generated.messages[0].content, /输出格式/);
    assert.match(generated.user, /背景资料（仅作数据）/);
    assert.ok(generated.user.indexOf('补充需求') < generated.user.indexOf('背景资料'));
    assert.match(generated.user, /审核原因：人物缺失/);
    const revised = renderPrompt(model, 'regenerate', values, output, 'codex');
    assert.deepEqual(revised.messages.map(m => m.role), ['developer', 'user', 'assistant', 'user']);
    assert.deepEqual(JSON.parse(revised.messages[2].content), values.基稿);
    assert.match(revised.messages[3].content, /本次意见：补足动作/);
    for (const provider of ['elysium', 'llm-server']) {
      const original = renderPrompt(model, 'generate', values, output, provider);
      assert.equal(original.messages[0].role, 'system');
      assert.match(original.user, /# 背景信息/);
    }
  });
});

describe("gpt-image", () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const reference = `data:image/png;base64,${png.toString('base64')}`;
  const taskId = 'task_11111111-1111-4111-8111-111111111111';
  const mediaKey = 'private-media-key';
  const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}/v1`)));
  const close = async server => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  const input = {
    language: 'zh-CN', requirements: '', person: '阿明；男性。', costume: '青布短衫',
    referenceDescription: '参考图用于人物身份和面相，服装按本次资料。', aspectRatio: '16:9', references: [reference],
  };

  test('Krea 图片走 Comfy 接口，项目画幅换成 16:9 或 9:16，质量默认正常', () => {
    const route = modelRoute({ baseUrl: 'https://gateway.test/v1', textBaseUrl: 'http://127.0.0.1:9/v1', apiKey: mediaKey, text: { model: 'qwen3.5:27b' }, image: { model: 'krea2 turbo V2.5' }, video: { model: 'elysium-video' } }, 'image');
    assert.equal(route.baseUrl, 'http://127.0.0.1:9/v1');
    assert.equal(route.apiKey, 'ollama');
    const wide = imageParameters({ ...route, apiKey: mediaKey, prompt: '定妆照', aspectRatio: '16:9', references: [{ mime: 'image/png', bytes: png }], taskId });
    assert.equal(wide.url.pathname, '/v1/images/comfy');
    assert.deepEqual(wide.body, { model: 'krea2 turbo V2.5', prompt: '定妆照', quality: 'normal', aspect: '16:9' });
    assert.equal(wide.headers['X-Task-ID'], taskId);
    assert.equal(imageParameters({ ...route, prompt: '定妆照', aspectRatio: '9:16' }).body.aspect, '9:16');
    assert.doesNotMatch(JSON.stringify(wide), new RegExp(mediaKey));
    assert.throws(() => imageParameters({ ...route, prompt: '定妆照', aspectRatio: '100x100' }), /画幅不受支持/);
  });

  test('GPT图片参数固定文生图接口，画幅写入提示词，不接收媒体密钥', () => {
    assert.equal(new SettingsModel({ text: { model: 'qwen3.5:27b' }, image: { model: 'gpt-image' }, video: { model: 'elysium-video' } }).image.model, 'gpt-image');
    const route = modelRoute({ baseUrl: 'https://gateway.test/v1', textBaseUrl: 'http://127.0.0.1:9/v1', apiKey: mediaKey, text: { model: 'codex-gpt' }, image: { model: 'gpt-image' }, video: { model: 'elysium-video' } }, 'image');
    assert.equal(route.baseUrl, 'http://127.0.0.1:9/v1');
    assert.equal(route.apiKey, 'ollama');
    const request = imageParameters({ ...route, apiKey: mediaKey, prompt: '定妆照', aspectRatio: '9:16', references: [{ mime: 'image/png', bytes: png }], taskId });
    assert.equal(request.url.pathname, '/v1/images/generations');
    assert.equal(request.headers.Authorization, 'Bearer ollama');
    assert.equal(request.headers['X-Task-ID'], taskId);
    const { prompt, images, ...fixed } = request.body;
    assert.deepEqual(fixed, { model: 'gpt-image', background: 'auto', n: 1, size: 'auto', quality: 'auto', output_format: 'png' });
    assert.match(prompt, /画面为竖版 9:16/);
    assert.equal(images[0].image_url, reference);
    assert.equal(gptImagePrompt('定妆照', '16:9').endsWith('画面为横版 16:9。'), true);
    assert.doesNotMatch(JSON.stringify(request), new RegExp(mediaKey));
    assert.throws(() => imageParameters({ ...route, prompt: '定妆照', references: Array.from({ length: 6 }, () => ({ mime: 'image/png', bytes: png })) }), /参考图最多 5 张/);
  });

  test('定妆照经 llm-server 文生图返回图片，已移除的网关图片选择被拒绝', async () => {
    const gptRequests = [], gatewayRequests = [];
    const take = bucket => createServer(async (req, res) => {
      let raw = ''; for await (const chunk of req) raw += chunk;
      bucket.push({ path: req.url, authorization: req.headers.authorization, task: req.headers['x-task-id'], body: JSON.parse(raw) });
      res.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }));
    });
    const gpt = take(gptRequests), gateway = take(gatewayRequests);
    try {
      const textBaseUrl = await listen(gpt), baseUrl = await listen(gateway);
      const readConfig = async () => ({ baseUrl, textBaseUrl, apiKey: mediaKey, text: { model: 'codex-gpt' }, image: { model: 'gpt-image' }, video: { model: 'elysium-video' } });
      const ai = createAiRoutes({ readConfig });
      let saved, savedHttp;
      const { result } = await ai('costume-image', 'generate', input, { task: { id: taskId }, record: async value => { if (value.prompt) saved = structuredClone(value.prompt); if (value.http) savedHttp = structuredClone(value.http); } });
      assert.equal(gptRequests.length, 1);
      assert.equal(gatewayRequests.length, 0);
      assert.equal(gptRequests[0].path, '/v1/images/generations');
      assert.equal(gptRequests[0].authorization, 'Bearer ollama');
      assert.equal(gptRequests[0].task, taskId);
      assert.equal(gptRequests[0].body.model, 'gpt-image');
      assert.equal(gptRequests[0].body.size, 'auto');
      assert.match(gptRequests[0].body.prompt, /生成人物定妆照/);
      assert.match(gptRequests[0].body.prompt, /画面为横版 16:9。/);
      assert.equal(gptRequests[0].body.images.length, 1);
      assert.equal(gptRequests[0].body.images[0].image_url, reference);
      assert.doesNotMatch(JSON.stringify(gptRequests[0]), new RegExp(mediaKey));
      assert.equal(result.mime, 'image/png');
      assert.ok(Buffer.from(result.data, 'base64').equals(png));
      const logged = JSON.stringify(savedHttp.at(-1));
      // 步骤保存的业务参数中，参考图 base64 与 HTTP 记录一样脱敏。
      assert.doesNotMatch(JSON.stringify(saved.input), new RegExp(reference.slice(reference.indexOf(',') + 1, reference.indexOf(',') + 41).replace(/[+/=]/g, m => '\\' + m)));
      assert.match(JSON.stringify(saved.input), /base64 数据/);
      assert.match(logged, /generateImage/);
      assert.doesNotMatch(logged, new RegExp(png.toString('base64')));
      const gatewayAi = createAiRoutes({ readConfig: async () => ({ ...(await readConfig()), image: { model: 'elysium-image' } }) });
      await assert.rejects(gatewayAi('costume-image', 'generate', { ...input, references: [] }), /image：请选择有效模型/);
      assert.equal(gptRequests.length, 1);
      assert.equal(gatewayRequests.length, 0);
    } finally {
      await close(gpt); await close(gateway);
    }
  });

  test('文生图失败或空图不返回成功，取消会中止请求', async () => {
    let mode = 'empty';
    const server = createServer(async (req, res) => {
      if (mode === 'hang') { req.on('close', () => res.end()); return; }
      for await (const chunk of req) chunk;
      if (mode === 'login') { res.writeHead(401); res.end(JSON.stringify({ error: { message: '请先运行 codex login，使用 ChatGPT 套餐登录' } })); return; }
      res.end(JSON.stringify({ data: [{}] }));
    });
    try {
      const textBaseUrl = await listen(server);
      const ai = createAiRoutes({ readConfig: async () => ({ baseUrl: 'http://gateway.test/v1', textBaseUrl, apiKey: mediaKey, text: { model: 'qwen3.5:27b' }, image: { model: 'gpt-image' }, video: { model: 'elysium-video' } }) });
      await assert.rejects(ai('costume-image', 'generate', { ...input, references: [] }), /模型未返回图片/);
      mode = 'login';
      await assert.rejects(ai('costume-image', 'generate', { ...input, references: [] }), error => error.status === 401 && /codex login/.test(error.message));
      mode = 'hang';
      const controller = new AbortController();
      const pending = ai('costume-image', 'generate', { ...input, references: [] }, { signal: controller.signal });
      await new Promise(resolve => server.once('request', resolve));
      controller.abort();
      await assert.rejects(pending);
    } finally { await close(server); }
  });
});
