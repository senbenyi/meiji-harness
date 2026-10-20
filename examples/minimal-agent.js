import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { modelClient } from '@agent-modules/http-client';
import { fillTemplate, renderSections, composeMessages } from '@agent-modules/prompt-composer';

// 独立 Agent 示例：模型服务用本地 HTTP 模拟，不调用真实模型、不消耗额度。
const jobs = new Map();
const server = createServer(async (request, response) => {
  const json = (value, status = 200) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(value));
  };
  if (request.method === 'POST') {
    let text = ''; for await (const chunk of request) text += chunk;
    const body = JSON.parse(text), id = request.headers['x-task-id'];
    const result = request.url.includes('/chat/') ? { choices: [{ finish_reason: 'stop', message: { content: '一段产品介绍' } }] }
      : request.url.includes('/images/') ? { data: [{ b64_json: Buffer.from('mock-image-bytes').toString('base64') }] }
      : { status: 'succeeded', task_id: 'video-1', url: `http://127.0.0.1:${server.address().port}/media/video.mp4` };
    if (id) {
      assert.equal(jobs.has(id), false, '同一请求不得重复生成');
      assert.equal(request.headers['idempotency-key'], id);
      jobs.set(id, { body, result }); return json({ task_id: id }, 202);
    }
    return json(result);
  }
  if (request.url.startsWith('/v1/tasks/')) {
    const id = request.url.split('/')[3], job = jobs.get(id);
    if (!job) return json({}, 404);
    return json(request.url.endsWith('/result') ? job.result : { status: 'succeeded' });
  }
  if (request.url === '/media/video.mp4') return response.end('mock-video-bytes');
  json({}, 404);
});

server.listen(0, '127.0.0.1');
await once(server, 'listening');
try {
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  // 规则由这个 Agent 自己维护；编排包没有任何内置业务规则。
  const template = fillTemplate({ system: { 规则: '{{rules}}' }, user: { 任务: '介绍产品', 资料: '{{product}}' } }, {
    rules: '根据提供的参数写一段产品介绍。', product: { 名称: '便携灯', 功率: '5W' },
  });
  const { messages } = composeMessages({ system: renderSections(template.system), user: renderSections(template.user) });
  const text = await modelClient.complete({ baseUrl, model: 'qwen3.5:27b', messages });
  const image = await modelClient.generateImage({ baseUrl, model: 'gpt-image', prompt: '便携灯海报', aspectRatio: '1:1', requestId: 'product_image_1' });
  const video = await modelClient.generateVideo({ baseUrl, model: 'MiniMax-H3', prompt: '便携灯产品展示', duration: 5, mode: 'text', aspectRatio: '16:9', requestId: 'product_video_1' });
  const bytes = await modelClient.downloadVideo({ url: video.url });
  assert.equal(text, '一段产品介绍');
  assert.equal(image.toString(), 'mock-image-bytes');
  assert.equal(bytes.toString(), 'mock-video-bytes');
  assert.equal(jobs.size, 2);
  console.log('独立 Agent 接入通过：提示词编排、文本、图片、异步视频与下载。');
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
