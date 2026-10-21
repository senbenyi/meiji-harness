import { randomUUID } from 'node:crypto';
import { recordTitle } from './record-title.js';

const fields = ['provider', 'model', 'messages', 'system', 'tools', 'toolHistory', 'temperature', 'maxTokens', 'stop', 'reasoningEffort', 'sessionId', 'purpose'];
const snapshot = value => JSON.parse(JSON.stringify(value));

/**
 * 记录适配器层模型请求，不宣称捕获HTTP原始报文。输入遵循messages/tools及流式block/delta/finish协议。
 * record接受HttpRecords.record回调；不引用宿主、项目、URL或数据库。每次stream消费独立入库。
 */
export function createModelRecorder({ record } = {}) {
  if (typeof record !== 'function') throw new TypeError('需提供record回调');
  const active = new Set();
  let closed = false, closing;
  const finish = (entry, override) => {
    if (entry.finishing) return entry.finishing;
    entry.finalizing = true;
    entry.finishing = (async () => {
      try {
        await entry.started;
        const reason = override || entry.reason || { kind: 'interrupted', failure: { message: '模型返回未结束' } };
        const ok = !['error', 'aborted', 'interrupted'].includes(reason.kind);
        const content = [...entry.blocks.values()].map(block => snapshot(block));
        if (ok) entry.transfer.title = recordTitle({ title: entry.requestTitle, method: 'MODEL', params: entry.transfer.request.body, response: { content } });
        Object.assign(entry.transfer, { ok, error: ok ? '' : reason.failure?.message || reason.kind,
          body: { capture_layer: 'model-adapter', content, chunks: entry.chunks, usage: entry.usage ?? null,
            finish_reason: reason, complete: ok } });
        await record(entry.transfer);
      } finally { active.delete(entry); }
    })();
    return entry.finishing;
  };
  const append = (entry, chunk) => {
    const saved = snapshot(chunk); entry.chunks.push(saved);
    const index = chunk.index;
    if (chunk.type === 'block-start') {
      entry.blocks.set(index, { type: chunk.blockType, ...(['text', 'reasoning'].includes(chunk.blockType) ? { text: '' } : {}) });
    } else if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
      const block = entry.blocks.get(index) || { type: chunk.type === 'text-delta' ? 'text' : 'reasoning', text: '' };
      block.text = (block.text || '') + chunk.text; entry.blocks.set(index, block);
    } else if (chunk.type === 'tool-call-delta') {
      const block = entry.blocks.get(index) || { type: 'tool-call', arguments: '' };
      block.id = chunk.id; if (chunk.name !== undefined) block.name = chunk.name;
      block.arguments = (block.arguments || '') + chunk.argumentsDelta; entry.blocks.set(index, block);
    } else if (chunk.type === 'block-end') entry.blocks.set(index, saved.block);
    else if (chunk.type === 'usage') entry.usage = saved.usage;
    else if (chunk.type === 'finish') entry.reason = saved.reason;
  };
  return {
    async *stream(options, next) {
      if (closed) { yield* next(); return; }
      const request = snapshot(Object.fromEntries(fields.filter(key => options[key] !== undefined).map(key => [key, options[key]])));
      const transfer = { id: randomUUID(), title: recordTitle({ title: options.title, method: 'MODEL', params: options }), method: 'MODEL', path: `model://${encodeURIComponent(options.provider)}/${encodeURIComponent(options.model)}/${options.purpose || 'conversation'}`,
        request: { headers: {}, body: { capture_layer: 'model-adapter', ...request } } };
      const entry = { transfer, requestTitle: options.title, chunks: [], blocks: new Map() };
      active.add(entry);
      entry.started = Promise.resolve().then(() => record(transfer));
      try {
        await entry.started;
        if (closed || entry.finalizing) return;
        for await (const chunk of next()) {
          if (!entry.finalizing) append(entry, chunk);
          yield chunk;
        }
      } catch (error) {
        if (!entry.finalizing) entry.reason = { kind: options.signal?.aborted ? 'aborted' : 'error', failure: { message: error.message || String(error) } };
        throw error;
      } finally {
        if (!entry.reason && options.signal?.aborted) entry.reason = { kind: 'aborted', failure: { message: '模型调用已取消' } };
        await finish(entry);
      }
    },
    /** 先落盘未结束流的部分返回；已销毁后的晚到增量继续透传但不再写库。 */
    dispose() {
      if (closing) return closing;
      closed = true;
      closing = Promise.all([...active].map(entry => finish(entry, { kind: 'interrupted', failure: { message: '记录器关闭时模型调用尚未结束' } }))).then(() => {});
      return closing;
    },
  };
}
