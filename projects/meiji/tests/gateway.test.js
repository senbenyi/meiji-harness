import { defaultRules } from '../shared/rule-defaults.js';
import { elysiumClient } from "../server/http/elysium/client.js";
import { parseJsonValue } from "../server/prompts/parse-json.js";
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { decodeImageData, dataUrl } from "../server/media/decode-image-data.js";
import { saveLastFrame } from "../server/media/extract-video-tail.js";
import { createServer } from "node:http";
import { createAiRoutes, composeNodePrompt, validateNodeResult } from "../server/http/ai-routes.js";
import { videoRequest } from "../server/http/video-request.js";
import { taskNodeInput } from "../server/handlers/node-inputs.js";
import { config } from "./fixtures/ai.js";
import { emptyCharacterModel } from "../shared/models/character_model.js";
import { projectFixture } from "./fixtures/project.js";
import { getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { sendChat, requestTimeoutMs, requestDispatcher } from "../server/http/chat-transport.js";
import { llmServerClient } from "../server/http/llm-server/client.js";

describe("foundations", () => {
  const connection = {
    baseUrl: "https://gateway.test/v1/",
    apiKey: "test-only-key",
    model: "mock-model",
  };
  const json = (data) =>
    new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    });
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );

  test("文本网关请求分离 system/user，解析内容并拒绝非完整输出", async () => {
    const text = await elysiumClient.complete({
      ...connection, model: "elysium-chat",
      messages: [{ role: "system", content: "系统" }, { role: "user", content: "用户" }],
      fetchImpl: async (url, options) => {
        assert.equal(url.pathname, "/v1/chat/completions");
        assert.equal(options.headers.Authorization, "Bearer test-only-key");
        const body = JSON.parse(options.body);
        assert.deepEqual(body.messages, [
          { role: "system", content: "系统" },
          { role: "user", content: "用户" },
        ]);
        assert.equal(body.reasoning_effort, undefined);
        assert.equal(body.temperature, undefined);
        assert.equal(body.top_p, undefined);
        assert.equal(body.presence_penalty, undefined);
        assert.equal(body.max_tokens, undefined);
        assert.equal(body.response_format, undefined);
        assert.equal(body.model, "elysium-chat");
        assert.equal(body.stream, false);
        return json({
          choices: [
            { finish_reason: "stop", message: { content: ' {"正文":"完成"} ', reasoning: "不应作为正文返回" } },
          ],
        });
      },
    });
    assert.deepEqual(parseJsonValue(text), { 正文: "完成" });
    await assert.rejects(
      elysiumClient.complete({
        ...connection, model: "elysium-chat",
        messages: [{ role: "user", content: "测试" }],
        fetchImpl: async () =>
          json({
            choices: [
              { finish_reason: "length", message: { content: "未完成" } },
            ],
          }),
      }),
      /未正常完成/,
    );
  });

  test("文本网关普通协议：400 不重试，非法 JSON 不因 HTTP200 变成有效结果", async () => {
    let calls = 0;
    await assert.rejects(elysiumClient.complete({ ...connection, model: "elysium-chat", messages: [{ role: "user", content: "返回 JSON" }], fetchImpl: async () => {
      calls++;
      return new Response(JSON.stringify({ error: { message: "字段无效", code: "invalid_request" } }), { status: 400 });
    } }), /字段无效/);
    assert.equal(calls, 1);
    const text = await elysiumClient.complete({ ...connection, model: "elysium-chat", messages: [{ role: "user", content: "返回 JSON" }], fetchImpl: async () => json({ choices: [{ finish_reason: "stop", message: { content: "这不是JSON" } }] }) });
    assert.throws(() => parseJsonValue(text));
  });


  test("图片解码与 JSON 提取拒绝无效类型和语法", () => {
    assert.deepEqual(
      decodeImageData(dataUrl(png, "image/png")),
      { mime: "image/png", bytes: png },
    );
    assert.equal(
      decodeImageData(png.toString("base64"), "image/jpg").mime,
      "image/jpeg",
    );
    assert.throws(() => decodeImageData("bad", "image/gif"), /PNG/);
    assert.deepEqual(parseJsonValue('```json\n[{"正文":"内容"}]\n```'), [
      { 正文: "内容" },
    ]);
    assert.throws(() => parseJsonValue('{"正文":'), /JSON/);
  });

  test("真实 FFmpeg 从短视频抽取非空 PNG 尾帧", async () => {
    const dir = await mkdtemp(join(tmpdir(), "meiji-tail-baseline-"));
    try {
      const video = join(dir, "input.mp4"),
        frame = join(dir, "tail.png");
      const result = spawnSync(
        "ffmpeg",
        [
          "-y",
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "lavfi",
          "-i",
          "color=c=red:s=32x32:d=0.2",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          video,
        ],
        { encoding: "utf8" },
      );
      assert.equal(result.status, 0, result.stderr);
      const bytes = await saveLastFrame(video, frame);
      assert.deepEqual(
        bytes.subarray(0, 8),
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("http-contracts", () => {
  const sections = { integrated_multimodal_description: 'A woman opens the door. {{literal}}', overall_soundscape: 'Wind.', non_diegetic_music: 'None.' };
  const text = Object.entries(sections).map(([k, v]) => `${k}:\n${v}`).join('\n\n');
  const video = { type: '文生', textPrompt: text, duration: 5, aspectRatio: '16:9' };
  const image = 'data:image/png;base64,aW1hZ2U=';
  const common = { language: 'zh-CN', requirements: '' };

  test('三种视频方式都发给 MiniMax H3，mode 固定为文生、首尾帧、多模态', async () => {
    const seen = [];
    const server = createServer(async (req, res) => {
      if (req.method === 'GET') { res.end(Buffer.from('mp4')); return; }
      let raw = '';
      for await (const chunk of req) raw += chunk;
      seen.push({ authorization: req.headers.authorization, body: JSON.parse(raw) });
      res.end(JSON.stringify({ task_id: `task-${seen.length}`, status: 'succeeded', url: `http://127.0.0.1:${server.address().port}/out.mp4` }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const textBaseUrl = `http://127.0.0.1:${server.address().port}/v1`;
      const ai = createAiRoutes({ readConfig: async () => ({ ...config, textBaseUrl }) });
      for (const input of [video, { ...video, type: '首尾帧', firstFrame: image }, { ...video, type: '多模态', referenceImages: [image] }]) {
        const { result, prompt } = await ai('video', 'generate', input);
        assert.equal(result.remote_id, `task-${seen.length}`);
        assert.equal(result.server_address, `http://127.0.0.1:${server.address().port}/out.mp4`);
        assert.equal(prompt.model, 'MiniMax-H3');
        assert.equal(prompt.parameters.remote_id, `task-${seen.length}`);
      }
      for (const { body } of seen) {
        assert.ok(body.prompt.includes(text));
        assert.ok(body.prompt.includes(defaultRules('video').generate.base));
        assert.doesNotMatch(body.prompt, /# 角色|# 输出格式|视频制作执行器/);
      }
      assert.deepEqual(seen.map(item => item.body.mode), ['文生', '首尾帧', '多模态']);
      assert.equal(seen[0].authorization, 'Bearer ollama');
      assert.equal('model' in seen[0].body, false);
      assert.deepEqual(Object.keys(seen[0].body).sort(), ['duration', 'mode', 'prompt', 'ratio', 'resolution']);
      assert.deepEqual(Object.keys(seen[1].body).sort(), ['duration', 'first_frame', 'mode', 'prompt', 'ratio', 'resolution']);
      assert.deepEqual(Object.keys(seen[2].body).sort(), ['duration', 'images', 'mode', 'prompt', 'ratio', 'resolution']);
      assert.match(seen[2].body.images[0], /^data:image\/png;base64,/);
      assert.equal(seen[0].body.ratio, '16:9');
      assert.equal(seen[0].body.resolution, '768P');
      assert.equal('first_frame' in seen[0].body, false);
      assert.equal(seen[1].body.ratio, 'adaptive');
      assert.equal(seen[1].body.first_frame, image);
      assert.equal(seen[2].body.ratio, '16:9');
      assert.deepEqual(seen[2].body.images, [image]);
      assert.equal('first_frame' in seen[2].body, false);
      assert.doesNotMatch(JSON.stringify(seen), /test-only/);
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });

  test('视频生成缺少任务ID或返回URL时拒绝，不拼接旧content地址', async () => {
    for (const located of [{ taskId: 'remote' }, { url: 'https://example.test/video.mp4' }, { id: 'remote' }]) {
      const ai = createAiRoutes({ readConfig: async () => config, gateway: { video: async () => located } });
      await assert.rejects(ai('video', 'generate', video), /服务端视频地址/);
    }
  });

  test('视频错误类型/素材/时长/修订意见在读取配置前拒绝', async () => {
    let reads = 0;
    const ai = createAiRoutes({ readConfig: async () => { reads++; return config; } });
    for (const change of [{ type: undefined }, { type: 'auto' }, { duration: 3 }, { duration: 16 }, { duration: 5.5 }, { firstFrame: image }, { referenceImages: [] }, { type: '首尾帧' }, { type: '多模态', referenceImages: [] }, { type: '多模态', referenceImages: Array(10).fill(image) }, { type: '首尾帧', firstFrame: 'not-a-base64!'  }]) await assert.rejects(ai('video', 'generate', { ...video, ...change }), /输入|视频/);
    await assert.rejects(ai('video', 'regenerate', { ...video, opinion: ' ' }), /意见/);
    assert.equal(reads, 0);
    for (const duration of [4, 15]) assert.equal(videoRequest({ ...video, duration }).duration, duration);
    const revised = videoRequest({ ...video, opinion: '加快动作' }, 'regenerate');
    assert.equal(revised.prompt, text + '\n\nRevision instructions:\n加快动作');
    assert.equal(video.textPrompt, text);
  });

  test('storyboard 输入不携带图片状态/前镜资料，但保留只发声人物的文字身份', () => {
    const p = projectFixture(), shot = p.episodes[0].shot_list.shots[0], person = emptyCharacterModel({ name: '甲' });
    p.character_library.characters.push(person);
    shot.on_screen_characters = [];
    shot.seconds_storyboard.storyboard[0].dialogue = [{ speaker_id: person.id, speaker_name: person.name, mode: '画外音', dialogue_text: '你好' }];
    const input = taskNodeInput({ project: p, tasks: [], steps: [] }, { business_type: 'storyboard', target_id: shot.id }, null, 'generate');
    assert.ok(input.characters.some(row => row.name === person.name));
    assert.doesNotMatch(JSON.stringify(input), /has_image|assets|previous|costume_images/);
    const prompt = composeNodePrompt('storyboard', 'generate', input, 'elysium-chat');
    assert.match(prompt.system, /画面描述、运镜、声景和配乐说明均使用简体中文/);
    assert.doesNotMatch(prompt.system, /画面描述使用英文|完整英文动作/);
    assert.doesNotMatch(prompt.body, /固定素材清单|前镜衔接|上一镜交接/);
    assert.throws(() => composeNodePrompt('storyboard', 'generate', { ...input, assets: [] }, 'elysium-chat'), /未定义/);
  });

  test('HTTP 输出拒绝空段落及互相矛盾的审核结果，规则拒绝未声明字段', () => {
    assert.throws(() => validateNodeResult('storyboard', 'generate', text.replace('Wind.', '')), /不能为空/);
    for (const review of [{ 是否通过: true, "类型": "", 原因: '但有问题' }, { 是否通过: false, "类型": "模型问题", 原因: ' ' }]) assert.throws(() => validateNodeResult('project-summary', 'review', review), /原因/);
    assert.throws(() => composeNodePrompt('project-summary', 'generate', { ...common, script: '剧本', rules: [{ constraint: '必须', content: '保持剧情', output: {} }] }, 'elysium-chat'), /输入.rules/);
  });

  test('定妆照拒绝多个或非字符串参考图，不进入模型请求', async () => {
    const ai = createAiRoutes({ readConfig: async () => { throw Error('不应读取配置'); } });
    const input = { ...common, person: '甲', costume: '白衣', referenceDescription: '', aspectRatio: '16:9', references: [image, image] };
    await assert.rejects(ai('costume-image', 'generate', input), /最多使用一张/);
    await assert.rejects(ai('costume-image', 'generate', { ...input, references: [{}] }), /字符串/);
  });

});

describe("timeout", () => {
  test('文本和GPU总时限60分钟，底层响应超时60分钟且保留宿主代理', async t => {
    assert.equal(requestTimeoutMs, 3600000);
    const original = getGlobalDispatcher();
    const seen = [];
    setGlobalDispatcher({ dispatch(options) { seen.push(options); return true; }, close: () => Promise.resolve(), destroy: () => Promise.resolve() });
    t.after(() => setGlobalDispatcher(original));
    const durations = [];
    t.mock.method(AbortSignal, 'timeout', ms => { durations.push(ms); return new AbortController().signal; });
    const fetchImpl = async (url, options) => {
      assert.equal(options.dispatcher, requestDispatcher);
      options.dispatcher.dispatch({ origin: new URL(url).origin, path: '/test' }, {});
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }), json: async () => ({ gpus: [] }) };
    };
    assert.equal(await sendChat({ url: new URL('http://localhost/v1/chat/completions'), body: {}, headers: {} }, { fetchImpl }), 'ok');
    await llmServerClient.gpu({ baseUrl: 'http://localhost/v1', fetchImpl });
    assert.deepEqual(durations, [3600000, 3600000]);
    assert.equal(seen.length, 2);
    for (const options of seen) { assert.equal(options.headersTimeout, 3600000); assert.equal(options.bodyTimeout, 3600000); }
  });
});
