import test from 'node:test';
import assert from 'node:assert/strict';
import { fillTemplate, renderSections, composeMessages } from '../src/index.js';

test('完整占位符保留结构与空值，注入资料只展开一次且不修改输入', () => {
  const values = { source: { text: '{{another}}', empty: '', nullable: null, flag: false }, name: '读者' };
  const template = { request: '{{source}}', title: '给{{name}}', absent: '', nested: ['{{source}}'] };
  const before = structuredClone({ values, template });
  const result = fillTemplate(template, values);
  assert.deepEqual(result.request, values.source);
  assert.equal(result.title, '给读者');
  assert.equal(Object.hasOwn(result, 'absent'), false);
  result.request.text = '修改结果';
  assert.deepEqual({ values, template }, before);
  assert.deepEqual(result.nested[0], values.source);
});

test('缺少资料与把对象嵌入文本明确失败，支持调用方错误协议', () => {
  assert.throws(() => fillTemplate('{{missing}}', {}), { code: 'INVALID_TEMPLATE', path: '占位符' });
  assert.throws(() => fillTemplate('前缀{{data}}', { data: {} }), /只能为文本/);
  assert.throws(() => fillTemplate('{}', []), /需为对象/);
  assert.throws(() => fillTemplate('{{missing}}', {}, { fail(path, message) { throw new Error(`custom:${path}:${message}`); } }), /custom:占位符/);
});

test('输出示例等字面量章节不参与展开，章节策略由调用方决定', () => {
  const filled = fillTemplate({ schema: { sample: '{{unknown}}', empty: '', flag: false }, body: '{{body}}' }, { body: '资料' }, { literalKeys: ['schema'] });
  assert.deepEqual(filled.schema, { sample: '{{unknown}}', empty: '', flag: false });
  const text = renderSections({ rules: { role: '校对' }, candidate: { text: '', flag: false }, list: ['a'], omitted: [] }, { jsonKeys: ['candidate'] });
  assert.match(text, /# rules\n## role\n校对/);
  assert.match(text, /"text": ""/);
  assert.match(text, /"flag": false/);
  assert.doesNotMatch(text, /omitted/);
});

test('修订历史与角色由接入方提供，不增加规则，也不修改历史', () => {
  const history = [{ role: 'user', content: '初始任务' }, { role: 'assistant', content: '基稿' }];
  const result = composeMessages({ system: '外部规则', user: '本轮意见', role: 'developer', history });
  assert.deepEqual(result.messages.map(row => row.role), ['developer', 'user', 'assistant', 'user']);
  assert.equal(result.body, '外部规则\n\n初始任务\n\n基稿\n\n本轮意见');
  result.messages[1].content = '改变';
  assert.equal(history[0].content, '初始任务');
  assert.deepEqual(composeMessages({ system: '', user: '任意任务' }).messages, [{ role: 'system', content: '' }, { role: 'user', content: '任意任务' }]);
});
