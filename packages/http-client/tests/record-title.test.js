import test from 'node:test';
import assert from 'node:assert/strict';
import { recordTitle } from '../src/record-title.js';
const title = (messages, response, extra = {}) => recordTitle({ method: 'MODEL', params: { messages }, response, ...extra });

test('摘要取最新用户文本，不取system/assistant/tool/图片或推理，按首句与Unicode长度截断', () => {
  assert.equal(title([{ role: 'user', content: '旧问题' }, { role: 'system', content: '系统要求' }, { role: 'user', content: [{ type: 'image', url: 'image' }, { type: 'text', text: '帮我优化剧本节奏。不要增加剧情' }] }, { role: 'assistant', content: '好的' }]), '优化剧本节奏');
  assert.equal(title([{ role: 'user', content: [{ type: 'image', url: 'image' }] }]), '会话回复');
  const long = title([{ role: 'user', content: '😀'.repeat(50) }]);
  assert.equal(Array.from(long).length, 30); assert.ok(long.endsWith('…'));
});

test('返回只读取完整结构化名称，普通文本/推理/残缺JSON保留摘要；名称不重复', () => {
  const messages = [{ role: 'user', content: '创建项目' }];
  assert.equal(title(messages, { content: [{ type: 'text', text: '{"project_name":"三英战吕布"}' }] }), '创建项目：三英战吕布');
  for (const block of [{ type: 'text', text: '好的，已完成' }, { type: 'reasoning', text: '{"name":"思考"}' }, { type: 'tool-call', arguments: '{"name":' }])
    assert.equal(title(messages, { content: [block] }), '创建项目');
  assert.equal(title([{ role: 'user', content: '创建三英战吕布项目' }], { content: [{ type: 'tool-call', arguments: { name: '三英战吕布' } }] }), '创建三英战吕布项目');
  assert.ok(Array.from(title(messages, { content: [{ type: 'tool-call', arguments: { name: '很长的名称'.repeat(15) } }] })).length <= 30);
  assert.equal(recordTitle({ method: 'MODEL', params: { purpose: 'constructor' } }), 'constructor');
});


test('注入的运行环境和技能提醒不替代真实用户输入', () => {
  assert.equal(title([
    { role: 'user', content: '帮我创建项目' },
    { role: 'user', content: 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\nFiles and policies' },
    { role: 'user', content: [{ type: 'text', text: '<system-reminder>技能列表</system-reminder>' }] },
  ]), '创建项目');
  assert.equal(title([{ role: 'user', content: '<system-reminder>提醒</system-reminder>请提取人物' }]), '提取人物');
});
