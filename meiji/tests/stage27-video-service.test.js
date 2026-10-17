import test from 'node:test';
import assert from 'node:assert/strict';
import { videoRequest } from '../server/http/video-request.js';
import { videoPayload } from '../server/http/llm-server/params.js';
import { llmServerClient } from '../server/http/llm-server/client.js';
import { withGatewayTrace } from '../server/gateway/gateway-trace.js';
import { createVideoPromptHandler } from '../server/handlers/video-prompt-handler.js';
import { projectFixture } from './fixtures/project.js';
import { emptyCharacterModel } from '../shared/models/character_model.js';

const image = 'data:image/png;base64,aW1hZ2U=';
const textPrompt = { integrated_multimodal_description: '(S1)<d>别走。我还有话说。</d>', overall_soundscape: '风声', non_diegetic_music: 'N/A' };
const input = { type: '文生', textPrompt, duration: 4, aspectRatio: '768x1344' };
const options = { baseUrl: 'http://localhost:11435/v1', model: 'MiniMax-H3' };
const response = extra => new Response(JSON.stringify({ task_id: 'remote-video', status: 'succeeded', url: 'https://cdn.example/result.mp4?signature=temporary', ...extra }));

test('三模式发送新接口白名单；首尾帧可显式给目标尾帧，不能混参考图', () => {
  const variants = [input, { ...input, type: '首尾帧', firstFrame: image, lastFrame: image }, { ...input, type: '多模态', referenceImages: [image] }];
  for (const row of variants) {
    const body = videoPayload({ model: 'MiniMax-H3', ...videoRequest(row) });
    assert.equal('model' in body, false);
    assert.equal(body.duration, 4); assert.equal(body.resolution, '768P');
    for (const key of ['seconds', 'size', 'input_reference', 'reference_images']) assert.equal(key in body, false);
    assert.equal(body.ratio, row.type === '首尾帧' ? 'adaptive' : '9:16');
    assert.equal('first_frame' in body, row.type === '首尾帧');
    assert.equal('last_frame' in body, row.type === '首尾帧');
    assert.equal('images' in body, row.type === '多模态');
  }
  for (const row of [{ ...input, lastFrame: image }, { ...input, type: '多模态', referenceImages: [image], lastFrame: image }]) assert.throws(() => videoRequest(row), /不能/);
});

test('先合并映射与三段正文再执行7000字符检查，不截断对白或偷偷改秒数', () => {
  const bindings = [{ name: '甲', speaker_tag: '(S2)', costume: '蓝色制服' }];
  const request = videoRequest({ ...input, type: '多模态', referenceImages: [image], referenceBindings: bindings });
  assert.match(request.prompt, /subject_definitions:\n<Subject 1> 是 <Picture 1> 中的"甲"\(S2\)，服装为"蓝色制服"/);
  assert.match(request.prompt, /summary:\n\[reference generation\] 目标视频以 <Subject 1> 作为参考/);
  assert.match(request.prompt, /retention_analysis:\n<Subject 1>（出现在 \[Shot 1\]）：fully_preserved/);
  assert.match(request.prompt, /detailed_description:\n\[Shot 1\] \(S1\)<d>别走。我还有话说。<\/d>/);
  assert.match(request.prompt, /<d>别走。我还有话说。<\/d>/);
  assert.throws(() => videoRequest({ ...input, type: '多模态', referenceImages: [image], referenceBindings: [] }), /一图一项/);
  assert.throws(() => videoRequest({ ...input, textPrompt: { ...textPrompt, integrated_multimodal_description: '长'.repeat(7000) } }), /7000/);
  assert.throws(() => videoRequest({ ...input, duration: 3 }), /4 到 15/);
});

test('时间线里的人物和场景改标为 Subject，对白内的姓名保持原文', () => {
  const bindings = [{ name: '甲', speaker_tag: '(S1)', costume: '蓝衣' }, { kind: 'scene', name: '老宅', description: '木门', state: '白天' }];
  const text = { ...textPrompt, integrated_multimodal_description: '[Shot 1] 甲站在老宅门口约两秒。(S1)说：<d>甲，别走。</d>' };
  const request = videoRequest({ ...input, type: '多模态', textPrompt: text, referenceImages: [image, image], referenceBindings: bindings });
  assert.match(request.prompt, /detailed_description:\n\[Shot 1\] <Subject 1>站在<Subject 2>门口约两秒。\(S1\)说：<d>甲，别走。<\/d>/);
  assert.doesNotMatch(request.prompt, /detailed_description:[\s\S]*<Picture /);
  const packed = request.prompt;
  const saved = { ...input, type: '多模态', textPrompt: text, referenceImages: [image, image], referenceBindings: bindings, packedPrompt: packed };
  assert.equal(videoRequest(saved).prompt, packed);
  assert.throws(() => videoRequest({ ...saved, packedPrompt: packed.replace('甲，别走。', '别走。') }), /正文.*不一致/);
});

test('实际正文来自已保存编排，修订仅在末尾附加意见', () => {
  const packedPrompt = '明确的参考图映射\n' + Object.entries(textPrompt).map(([key,value]) => `${key}:\n${value}`).join('\n\n');
  const row = { ...input, type: '多模态', referenceImages: [image], packedPrompt };
  assert.equal(videoRequest(row).prompt, packedPrompt);
  assert.equal(videoRequest({ ...row, opinion: '保持动作落点' }, 'regenerate').prompt, packedPrompt + '\n\nRevision instructions:\n保持动作落点');
  assert.throws(() => videoRequest({ ...row, packedPrompt: packedPrompt.replace('别走。我还有话说。', '别走。') }), /正文.*不一致/);
});

test('程序编排按图片顺序映射全项目稳定speaker_tag及本镜服装，保存本地地址', async () => {
  const project = projectFixture(), shot = project.episodes[0].shot_list.shots[0];
  const a = emptyCharacterModel({ name: '甲' }), b = emptyCharacterModel({ name: '乙' });
  a.costumes = [{ id: 'coat-a', name: '蓝衣', description: '短外套', color: '蓝', material: '棉', props: [] }];
  a.costume_images = [{ costume_id: 'coat-a', address: 'a.png' }];
  b.costume_images = [{ costume_id: '', address: 'b.png' }];
  project.character_library.characters = [a, b];
  shot.on_screen_characters = [{ character_id: b.id, costume_id: '' }, { character_id: a.id, costume_id: 'coat-a' }];
  shot.text_to_video_prompt = { ...shot.text_to_video_prompt, ...textPrompt };
  const handler = createVideoPromptHandler({ media: { validate: async () => {}, read: async address => Buffer.from(address) } });
  const { content } = await handler({ snapshot: { project }, task: { business_type: 'multimodal', target_id: shot.id }, signal: new AbortController().signal });
  assert.deepEqual(content.reference_images, [{ address: 'b.png' }, { address: 'a.png' }]);
  assert.match(content.prompt, /<Subject 1> 是 <Picture 1> 中的"乙"\(S\d+\)/); assert.match(content.prompt, /<Subject 2> 是 <Picture 2> 中的"甲"\(S\d+\)[\s\S]*蓝衣/);
  const tag = [...[a.id, b.id]].sort((x,y) => x.localeCompare(y)).indexOf(b.id) + 1;
  assert.match(content.prompt, new RegExp(`<Subject 1> 是 <Picture 1> 中的"乙"\\(S${tag}\\)`));
  assert.doesNotMatch(JSON.stringify(content), /data:image/);
});

test('成功响应后下载无本地凭据，HTTP历史含下载状态和字节数', async () => {
  const calls = [], transfers = [];
  const fetchImpl = async (url, request) => { calls.push({ url: String(url), request }); return calls.length === 1 ? response() : new Response('mp4'); };
  const result = await withGatewayTrace(transfer => { if (!transfers.includes(transfer)) transfers.push(transfer); }, () => llmServerClient.generateVideo({ ...options, ...videoRequest(input), fetchImpl }));
  assert.equal(result.bytes.toString(), 'mp4'); assert.equal(result.taskId, 'remote-video');
  assert.equal(calls[1].request.headers, undefined);
  assert.equal(transfers[1].fn, 'downloadVideo'); assert.equal(transfers[1].bytes, 3); assert.equal(transfers[1].ok, true);
  assert.doesNotMatch(transfers[1].path, /signature/);
});

test('非成功状态和服务端402/503拒绝，不下载也不重新提交', async () => {
  for (const variant of [{ status: 'running' }, { status: 'failed' }, { http: 402 }, { http: 503 }]) {
    let calls = 0;
    const fetchImpl = async () => { calls++; return variant.http ? new Response(JSON.stringify({ error: { message: '服务不可用' } }), { status: variant.http }) : response(variant); };
    await assert.rejects(llmServerClient.generateVideo({ ...options, ...videoRequest(input), fetchImpl }), error => variant.http ? error.status === variant.http : /成功状态/.test(error.message));
    assert.equal(calls, 1);
  }
});

test('下载失败和空文件记入HTTP详情并拒绝，不返回假视频', async () => {
  for (const file of [new Response('expired', { status: 403 }), new Response('')]) {
    let calls = 0; const transfers = [];
    await assert.rejects(withGatewayTrace(transfer => { if (!transfers.includes(transfer)) transfers.push(transfer); }, () => llmServerClient.generateVideo({ ...options, ...videoRequest(input), fetchImpl: async () => ++calls === 1 ? response() : file })), /下载失败|空的/);
    assert.equal(calls, 2); assert.equal(transfers.at(-1).ok, false); assert.match(transfers.at(-1).error, /下载失败|空的/);
  }
});

test('请求期间取消，终止连接且不下载、不重新生成', async () => {
  const controller = new AbortController(); let calls = 0;
  const request = llmServerClient.generateVideo({ ...options, ...videoRequest(input), signal: controller.signal, fetchImpl: async (_url, request) => { calls++; controller.abort(); request.signal.throwIfAborted(); } });
  await assert.rejects(request, /abort/i); assert.equal(calls, 1);
});
