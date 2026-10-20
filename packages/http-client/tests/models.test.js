import test from 'node:test';
import assert from 'node:assert/strict';
import { modelClient, withRequestTrace } from '../src/index.js';
import { videoPayload } from '../src/llm-server/params.js';
import { requestRemoteTask, remoteTaskHeaders } from '../src/remote-task.js';

const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const baseUrl = 'http://models.example/v1';
const image = 'data:image/png;base64,YWJj';

test('其他 Agent 的文本模型名原样透传，不受业务项目的模型选项限制', async () => {
  const result = await modelClient.complete({ baseUrl, model: 'research-agent-model:v2', messages: [{ role: 'user', content: '整理资料' }],
    fetchImpl: async (_, request) => {
      const body = JSON.parse(request.body);
      assert.equal(body.model, 'research-agent-model:v2');
      assert.deepEqual(body.messages, [{ role: 'user', content: '整理资料' }]);
      return json({ choices: [{ finish_reason: 'stop', message: { content: '资料完成' } }] });
    },
  });
  assert.equal(result, '资料完成');
});

test('公共接口保留服务真实 HTTP 状态，不套用业务网关错误映射', async () => {
  await assert.rejects(modelClient.generateImage({ baseUrl, model: 'gpt-image', prompt: '海报', fetchImpl: async () => json({ error: { message: '请求过多' } }, 429) }), error => error.status === 429);
  await assert.rejects(modelClient.complete({ baseUrl, model: 'custom', messages: [], fetchImpl: async () => json({ error: { message: '参数不符' } }, 422) }), error => error.status === 422);
});

for (const model of ['gpt-image', 'krea2 turbo V2.5']) {
  test(`其他 Agent 直接使用 ${model} 公共图片接口，无需项目或任务模型`, async () => {
    const records = [];
    const bytes = await modelClient.generateImage({ baseUrl, apiKey: 'service-secret', model, prompt: '产品海报', aspectRatio: '1:1',
      references: model === 'gpt-image' ? [{ mime: 'image/png', bytes: Buffer.from('reference') }] : [],
      record(row) { if (!records.includes(row)) records.push(row); },
      fetchImpl: async (url, options) => {
        assert.equal(options.headers.Authorization, 'Bearer service-secret');
        assert.equal(new URL(url).pathname, model === 'gpt-image' ? '/v1/images/generations' : '/v1/images/comfy');
        const body = JSON.parse(options.body);
        if (model === 'gpt-image') { assert.equal(body.images.length, 1); assert.equal(body.size, 'auto'); }
        else { assert.equal(body.aspect, '1:1'); assert.equal(body.quality, 'normal'); }
        return json({ data: [{ b64_json: Buffer.from('完整图片').toString('base64') }] });
      },
    });
    assert.equal(bytes.toString(), '完整图片');
    assert.equal(records[0].fn, 'generateImage');
    assert.doesNotMatch(JSON.stringify(records), /service-secret|cmVmZXJlbmNl/);
  });
}

for (const mode of ['text', 'first_frame', 'reference']) {
  test(`公共视频接口 ${mode} 模式组装协议并返回服务端地址`, async () => {
    let calls = 0;
    const options = { baseUrl, model: 'MiniMax-H3', prompt: '产品旋转展示', duration: 5, aspectRatio: '16:9', mode,
      ...(mode === 'first_frame' ? { inputReference: image } : mode === 'reference' ? { referenceImages: [image] } : {}),
      fetchImpl: async (url, request) => {
        calls++; assert.equal(new URL(url).pathname, '/v1/videos/generations');
        const body = JSON.parse(request.body);
        assert.equal(body.resolution, '768P'); assert.equal(body.duration, 5);
        assert.equal(body.ratio, mode === 'first_frame' ? 'adaptive' : '16:9');
        if (mode === 'reference') assert.deepEqual(body.images, [image]);
        if (mode === 'first_frame') assert.equal(body.first_frame, image);
        return json({ status: 'succeeded', task_id: 'remote-42', url: 'https://cdn.example/video.mp4' });
      },
    };
    assert.deepEqual(await modelClient.generateVideo(options), { taskId: 'remote-42', url: 'https://cdn.example/video.mp4' });
    assert.equal(calls, 1);
  });
}

test('视频非法组合、时长和图片数量在发送前拒绝，服务错误不重新提交', async () => {
  const options = { baseUrl, model: 'MiniMax-H3', prompt: '测试', duration: 5, aspectRatio: '16:9', mode: 'text' };
  for (const change of [{ duration: 3 }, { referenceImages: [image] }, { mode: 'reference', referenceImages: Array(10).fill(image) }]) {
    await assert.rejects(modelClient.generateVideo({ ...options, ...change, fetchImpl: () => assert.fail('不得请求') }));
  }
  let calls = 0;
  await assert.rejects(modelClient.generateVideo({ ...options, fetchImpl: async () => { calls++; return json({ error: { message: '余额不足' } }, 402); } }), error => error.status === 402);
  assert.equal(calls, 1);
  assert.equal(videoPayload(options).mode, '文生');
});

for (const kind of ['image', 'video']) {
  test(`公共 ${kind} 可按稳定 requestId 恢复，从原地址取结果且不重复提交`, async () => {
    const seen = [], records = [];
    const options = { baseUrl, requestId: 'agent_request_1', recovering: true, resumeFrom: 'http://original/v1/images/generations',
      model: kind === 'image' ? 'gpt-image' : 'MiniMax-H3', prompt: '外部资料', mode: 'text', duration: 5, aspectRatio: '16:9', pollIntervalMs: 1,
      record: row => records.push(row),
      fetchImpl: async (url, request) => {
        assert.notEqual(request.method, 'POST'); seen.push(String(url));
        if (!String(url).endsWith('/result')) return json({ status: 'succeeded' });
        return json(kind === 'image' ? { data: [{ b64_json: Buffer.from('原图片').toString('base64') }] } : { status: 'succeeded', task_id: 'original', url: 'https://cdn.example/original.mp4' });
      },
    };
    const result = kind === 'image' ? await modelClient.generateImage(options) : await modelClient.generateVideo(options);
    assert.ok(seen.every(url => url.startsWith('http://original/v1/tasks/agent_request_1')));
    if (kind === 'image') assert.equal(result.toString(), '原图片');
    else assert.equal(result.taskId, 'original');
    assert.equal(records.at(-1).ok, true);
  });
}

test('受理响应丢失时查询同一请求，网络未知继续查询，缺失和过期不重新生成', async () => {
  const request = { url: `${baseUrl}/chat/completions`, headers: remoteTaskHeaders({}, 'r1'), body: {} };
  const seen = []; let queries = 0;
  const result = await requestRemoteTask(request, { id: 'r1', pollIntervalMs: 1, fetchImpl: async (url, options) => {
    seen.push(options.method || 'GET');
    if (options.method === 'POST' || queries++ === 0) throw new Error('网络断开');
    return String(url).endsWith('/result') ? json({ original: true }) : json({ status: 'succeeded' });
  } });
  assert.deepEqual(await result.json(), { original: true });
  assert.equal(seen.filter(method => method === 'POST').length, 1);
  for (const expired of [false, true]) {
    await assert.rejects(requestRemoteTask(request, { id: 'r1', recovering: true, resumeFrom: request.url,
      fetchImpl: async (url, options) => {
        assert.notEqual(options.method, 'POST');
        return expired && !String(url).endsWith('/result') ? json({ status: 'succeeded' }) : json({}, 404);
      },
    }), /过期/);
  }
});

test('恢复缺少稳定请求标识或原请求地址时拒绝，不能退回同步生成', async () => {
  for (const change of [{ requestId: undefined }, { resumeFrom: undefined }]) {
    await assert.rejects(modelClient.generateImage({ baseUrl, model: 'gpt-image', prompt: '原海报', requestId: 'original', recovering: true,
      resumeFrom: `${baseUrl}/images/generations`, ...change, fetchImpl: () => assert.fail('恢复不能创建新生成'),
    }), /没有可恢复/);
  }
});

for (const stopRemote of [false, true]) {
  test(`通用取消策略显式决定是否停止远端：${stopRemote}`, async () => {
    const controller = new AbortController(), seen = [];
    await assert.rejects(requestRemoteTask({ url: `${baseUrl}/videos/generations`, headers: remoteTaskHeaders({}, 'r2'), body: {} }, {
      id: 'r2', recovering: true, resumeFrom: `${baseUrl}/videos/generations`, signal: controller.signal,
      shouldStop: () => stopRemote, fetchImpl: async (url) => {
        seen.push(String(url));
        if (String(url).endsWith('/stop')) return json({}, 202);
        controller.abort(new Error('external cancellation')); return json({ status: 'running' });
      },
    }), /external cancellation/);
    assert.equal(seen.some(url => url.endsWith('/stop')), stopRemote);
  });
}

test('公共视频下载不转发服务密钥、不记录签名；HTTP错误和空文件留痕', async () => {
  const rows = [];
  const bytes = await withRequestTrace(row => rows.push(row), () => modelClient.downloadVideo({ url: 'https://cdn.example/v.mp4?signature=hidden', apiKey: 'secret', fetchImpl: async (_, options) => {
    assert.equal(options.headers, undefined); return new Response('video');
  } }));
  assert.equal(bytes.toString(), 'video'); assert.doesNotMatch(JSON.stringify(rows), /signature|hidden|secret/);
  for (const response of [new Response('expired', { status: 403 }), new Response('')]) {
    const errors = [];
    await assert.rejects(modelClient.downloadVideo({ url: 'https://cdn.example/v.mp4', record: row => errors.push(row), fetchImpl: async () => response }), /下载失败|空的/);
    assert.equal(errors.at(-1).ok, false); assert.match(errors.at(-1).error, /下载失败|空的/);
  }
});


for (const kind of ['text', 'image', 'video', 'download', 'gpu']) {
  test(`公共${kind}透传dispatcher与timeoutMs，异步查询沿用同一代理`, async t => {
    const dispatcher = { dispatch() { throw Error('mock fetch不实际发送'); } };
    const durations = [], calls = [];
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    t.mock.method(AbortSignal, 'timeout', ms => { durations.push(ms); return timeout(ms); });
    const payload = kind === 'text' ? { choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }
      : kind === 'image' ? { data: [{ b64_json: Buffer.from('image').toString('base64') }] }
      : { status: 'succeeded', task_id: 'remote', url: 'https://cdn.example/video.mp4' };
    const options = { baseUrl, requestId: 'custom-transport', dispatcher, timeoutMs: 1234,
      fetchImpl: async (url, request) => {
        calls.push({ url: String(url), dispatcher: request.dispatcher, signal: request.signal });
        if (kind === 'download') return new Response('video');
        if (kind === 'gpu') return json({ gpus: [] });
        if (request.method === 'POST') return json({}, 202);
        return json(String(url).endsWith('/result') ? payload : { status: 'succeeded' });
      },
    };
    if (kind === 'text') await modelClient.complete({ ...options, model: 'custom', messages: [] });
    if (kind === 'image') await modelClient.generateImage({ ...options, model: 'gpt-image', prompt: 'image' });
    if (kind === 'video') await modelClient.generateVideo({ ...options, model: 'MiniMax-H3', mode: 'text', prompt: 'video', duration: 5, aspectRatio: '16:9' });
    if (kind === 'download') await modelClient.downloadVideo({ ...options, url: 'https://cdn.example/video.mp4' });
    if (kind === 'gpu') await modelClient.gpu(options);
    assert.ok(calls.every(call => call.dispatcher === dispatcher && call.signal));
    assert.deepEqual(durations, [1234]);
    assert.equal(calls.length, ['download', 'gpu'].includes(kind) ? 1 : 3);
  });
}

test('视频下载自定义超时实际中止等待并保留失败记录', async () => {
  const rows = [];
  await assert.rejects(modelClient.downloadVideo({ url: 'https://cdn.example/video.mp4', timeoutMs: 5, record: row => rows.push(row),
    fetchImpl: async (_, { signal }) => {
      const { setTimeout: delay } = await import('node:timers/promises');
      await delay(50, undefined, { signal }); return new Response('late');
    },
  }), /abort/i);
  assert.equal(rows.at(-1).ok, false);
});
