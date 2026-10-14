import test from 'node:test';
import assert from 'node:assert/strict';
import { getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { sendChat, requestTimeoutMs, requestDispatcher } from '../server/http/chat-transport.js';
import { llmServerClient } from '../server/http/llm-server/client.js';

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
