import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createAiRoutes, composeNodePrompt, validateNodeResult } from '../server/http/ai-routes.js';
import { videoRequest } from '../server/http/video-request.js';
import { submitGatewayVideo } from '../server/gateway/model-gateway.js';
import { taskNodeInput } from '../server/handlers/node-inputs.js';
import { config } from './fixtures/ai.js';
import { emptyCharacterModel } from '../shared/models/character_model.js';
import { projectFixture } from './fixtures/project.js';

const sections = { integrated_multimodal_description: 'A woman opens the door. {{literal}}', overall_soundscape: 'Wind.', non_diegetic_music: 'None.' };
const text = Object.entries(sections).map(([k, v]) => `${k}:\n${v}`).join('\n\n');
const video = { type: '文生', textPrompt: text, duration: 5, aspectRatio: '16:9' };
const image = 'data:image/png;base64,aW1hZ2U=';
const common = { language: 'zh-CN', requirements: '' };

test('视频三种类型实际发出互斥协议，生成三段原文不被系统正文包裹', async () => {
  for (const input of [video, { ...video, type: '首尾帧', firstFrame: image }, { ...video, type: '多模态', referenceImages: [image] }]) {
    let payload, chats = 0;
    const ai = createAiRoutes({ readConfig: async () => config, gateway: {
      chat: async () => { chats++; throw Error('不应调用文本模型'); },
      submitVideo: options => submitGatewayVideo({ ...options, fetchImpl: async (_url, request) => { payload = JSON.parse(request.body); return new Response(JSON.stringify({ id: 'remote' }), { status: 200 }); } }),
      retrieveVideo: async () => Buffer.from('candidate'),
    } });
    const { result } = await ai('video', 'generate', input);
    assert.equal(result.mime, 'video/mp4');
    assert.equal(chats, 0);
    assert.equal(payload.seconds, '5');
    assert.equal(payload.size, '1024x576');
    assert.ok(payload.prompt.includes(text));
    if (input.type === '首尾帧') assert.equal(payload.prompt, "首帧为上一镜的尾帧，用作本镜0秒的开场画面。后续动作、运镜与声音按下文已审核分镜执行，不将首帧误作本镜目标尾帧。\n\n" + text);
    assert.doesNotMatch(payload.prompt, /# 角色|# 输出格式|视频制作执行器/);
    assert.deepEqual(Object.keys(payload).sort(), ['model', 'prompt', 'seconds', 'size', ...(input.type === '首尾帧' ? ['input_reference'] : input.type === '多模态' ? ['reference_images'] : [])].sort());
    if (input.type !== '首尾帧') assert.equal(payload.prompt, text);
  }
});

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
      assert.equal(result.mime, 'video/mp4');
      assert.equal(Buffer.from(result.data, 'base64').toString(), 'mp4');
      assert.equal(prompt.model, 'MiniMax-H3');
      assert.equal(prompt.parameters.remote_id, `task-${seen.length}`);
    }
    assert.deepEqual(seen.map(item => item.body.mode), ['文生', '首尾帧', '多模态']);
    assert.equal(seen[0].authorization, 'Bearer ollama');
    assert.equal(seen[0].body.model, 'MiniMax-H3');
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
  for (const review of [{ 是否通过: true, 原因: '但有问题' }, { 是否通过: false, 原因: ' ' }]) assert.throws(() => validateNodeResult('project-summary', 'review', review), /原因/);
  assert.throws(() => composeNodePrompt('project-summary', 'generate', { ...common, script: '剧本', rules: [{ constraint: '必须', content: '保持剧情', output: {} }] }, 'elysium-chat'), /未定义/);
});

test('定妆照拒绝多个或非字符串参考图，不进入模型请求', async () => {
  const ai = createAiRoutes({ readConfig: async () => { throw Error('不应读取配置'); } });
  const input = { ...common, person: '甲', costume: '白衣', referenceDescription: '', aspectRatio: '16:9', references: [image, image] };
  await assert.rejects(ai('costume-image', 'generate', input), /最多使用一张/);
  await assert.rejects(ai('costume-image', 'generate', { ...input, references: [{}] }), /字符串/);
});

test('网关直连入口同样拒绝猜类型和混用素材；9张及首帧裸Base64可用', async () => {
  let calls = 0;
  const base = { baseUrl: config.baseUrl, apiKey: config.apiKey, model: 'elysium-video', prompt: text, duration: 5, aspectRatio: '16:9', fetchImpl: async () => { calls++; return new Response('{"id":"remote"}'); } };
  for (const args of [{}, { mode: 'text', inputReference: image }, { mode: 'first_frame', inputReference: image, referenceImages: [image] }, { mode: 'reference', referenceImages: [] }, { mode: 'text', duration: 5.5 }]) await assert.rejects(submitGatewayVideo({ ...base, ...args }), /视频/);
  assert.equal(calls, 0);
  await submitGatewayVideo({ ...base, mode: 'reference', referenceImages: Array(9).fill(image) });
  await submitGatewayVideo({ ...base, mode: 'first_frame', inputReference: 'aW1hZ2U=' });
  assert.equal(calls, 2);
});
