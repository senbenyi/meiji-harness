import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createAiRoutes } from '../server/http/ai-routes.js';
import { imageParameters, gptImagePrompt } from '../server/http/llm-server/params.js';
import { modelRoute } from '../models/model-config.js';
import { SettingsModel } from '../shared/models/settings_model.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const reference = `data:image/png;base64,${png.toString('base64')}`;
const taskId = 'task_11111111-1111-4111-8111-111111111111';
const mediaKey = 'private-media-key';
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}/v1`)));
const close = async server => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
const input = {
  language: 'zh-CN', requirements: '', person: '阿明；男性。', costume: '青布短衫',
  referenceDescription: '参考图用于人物身份和面相，服装按本次资料。', aspectRatio: '1344x768', references: [reference],
};

test('GPT图片参数固定文生图接口，画幅写入提示词，不接收媒体密钥', () => {
  assert.equal(new SettingsModel({ text: { model: 'qwen3.5:27b' }, image: { model: 'gpt-image' }, video: { model: 'elysium-video' } }).image.model, 'gpt-image');
  const route = modelRoute({ baseUrl: 'https://gateway.test/v1', textBaseUrl: 'http://127.0.0.1:9/v1', apiKey: mediaKey, text: { model: 'codex-gpt' }, image: { model: 'gpt-image' }, video: { model: 'elysium-video' } }, 'image');
  assert.equal(route.baseUrl, 'http://127.0.0.1:9/v1');
  assert.equal(route.apiKey, 'ollama');
  const request = imageParameters({ ...route, apiKey: mediaKey, prompt: '定妆照', aspectRatio: '768x1344', references: [{ mime: 'image/png', bytes: png }], taskId });
  assert.equal(request.url.pathname, '/v1/images/generations');
  assert.equal(request.headers.Authorization, 'Bearer ollama');
  assert.equal(request.headers['X-Task-ID'], taskId);
  const { prompt, images, ...fixed } = request.body;
  assert.deepEqual(fixed, { model: 'gpt-image', background: 'auto', n: 1, size: 'auto', quality: 'auto', output_format: 'png' });
  assert.match(prompt, /画面为竖版 9:16/);
  assert.equal(images[0].image_url, reference);
  assert.equal(gptImagePrompt('定妆照', '1344x768').endsWith('画面为横版 16:9。'), true);
  assert.doesNotMatch(JSON.stringify(request), new RegExp(mediaKey));
  assert.throws(() => imageParameters({ ...route, prompt: '定妆照', references: Array.from({ length: 6 }, () => ({ mime: 'image/png', bytes: png })) }), /参考图最多 5 张/);
});

test('定妆照经 llm-server 文生图返回图片，网关图片仍走媒体尺寸', async () => {
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
    let saved;
    const { result } = await ai('costume-image', 'generate', input, { task: { id: taskId }, record: async value => { saved = structuredClone(value.prompt); } });
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
    const logged = JSON.stringify(saved.transfers.at(-1));
    assert.match(logged, /generateImage/);
    assert.doesNotMatch(logged, new RegExp(png.toString('base64')));
    const gatewayAi = createAiRoutes({ readConfig: async () => ({ ...(await readConfig()), image: { model: 'elysium-image' } }) });
    await gatewayAi('costume-image', 'generate', { ...input, references: [] });
    assert.equal(gptRequests.length, 1);
    assert.equal(gatewayRequests[0].authorization, `Bearer ${mediaKey}`);
    assert.equal(gatewayRequests[0].body.model, 'elysium-image');
    assert.equal(gatewayRequests[0].body.size, '1344x768');
    assert.equal(gatewayRequests[0].body.images, undefined);
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
