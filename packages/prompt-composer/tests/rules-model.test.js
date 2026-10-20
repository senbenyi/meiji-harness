import test from 'node:test';
import assert from 'node:assert/strict';
import { RulesModel, fillTemplate, renderSections, composeMessages } from '../src/index.js';

test('默认模型具有三个独立动作，补充能力默认关闭，可 JSON 往返', () => {
  const model = new RulesModel();
  assert.equal(model.supports_supplement, false);
  assert.deepEqual(JSON.parse(JSON.stringify(model)), {
    supports_supplement: false,
    rules: {
      generate: { base: '', supplement: '' },
      review: { base: '', supplement: '' },
      revise: { base: '', supplement: '' },
    },
  });
  assert.deepEqual(new RulesModel(JSON.parse(JSON.stringify(model))).toJSON(), model.toJSON());
});

test('解析只使用当前基础规则及本动作补充规则，快照不执行', () => {
  const model = new RulesModel({ supports_supplement: true, rules: {
    generate: { base: '过期生成规则', supplement: '生成补充' },
    review: { base: '过期审核规则', supplement: '审核补充' },
    revise: { base: '过期修订规则', supplement: '修订补充' },
  } });
  for (const [action, supplement] of [['generate', '生成补充'], ['review', '审核补充'], ['revise', '修订补充']]) {
    assert.deepEqual(model.resolve(action, '当前规则'), { base: '当前规则', supplement });
  }
  assert.deepEqual(model.resolve('generate', ''), { base: '', supplement: '生成补充' });
  assert.throws(() => model.resolve('generate'), { code: 'INVALID_RULES', path: 'currentBase' });
});

test('关闭能力时保留补充文本但不参与编排，重新开启无需丢失数据', () => {
  const model = new RulesModel({ rules: { generate: { base: '快照', supplement: '补充' } } });
  assert.deepEqual(model.resolve('generate', '当前规则'), { base: '当前规则', supplement: '' });
  const enabled = new RulesModel({ ...model.toJSON(), supports_supplement: true });
  assert.equal(enabled.resolve('generate', '当前规则').supplement, '补充');
  assert.equal(enabled.resolve('review', '审核规则').supplement, '');
});

test('输入、规则读取、序列化及解析结果互不共享可修改数据', () => {
  const input = { rules: { generate: { base: '原始快照', supplement: '原始补充' } } };
  const model = new RulesModel(input);
  input.rules.generate.base = '外部修改';
  model.rules.generate.base = '读取修改';
  model.toJSON().rules.generate.supplement = '序列化修改';
  model.resolve('generate', '当前').base = '解析修改';
  assert.deepEqual(model.rules.generate, { base: '原始快照', supplement: '原始补充' });
});

test('非法能力、规则字段、类型及动作明确失败', () => {
  for (const input of [null, [], { supports_supplement: 'false' }, { supports_supplement: undefined },
    { rules: null }, { rules: [] }, { rules: { other: {} } }, { unknown: true },
    { rules: { generate: null } }, { rules: { generate: { base: 1 } } },
    { rules: { review: { supplement: false } } }, { rules: { revise: { extra: '' } } }]) {
    assert.throws(() => new RulesModel(input), { code: 'INVALID_RULES' });
  }
  const model = new RulesModel();
  for (const action of ['other', '__proto__', undefined]) {
    assert.throws(() => model.resolve(action, ''), { code: 'INVALID_RULES', path: 'action' });
  }
  assert.throws(() => model.resolve('review', null), { code: 'INVALID_RULES', path: 'currentBase' });
});

test('模型直接接入现有编排，规则文本中的占位符保留字面量', () => {
  const model = new RulesModel({ supports_supplement: true, rules: {
    generate: { base: '旧快照', supplement: '保留 {{literal}}' },
  } });
  const template = fillTemplate({ 规则: '{{rules}}' }, { rules: model.resolve('generate', '当前基础规则') });
  const result = composeMessages({ system: renderSections(template), user: '生成' });
  assert.equal(result.messages.length, 2);
  assert.match(result.system, /当前基础规则/);
  assert.match(result.system, /保留 \{\{literal\}\}/);
  assert.doesNotMatch(result.system, /旧快照|review|revise/);
});

test('显式 setSupplement 更新同一实例，仅改选中动作，禁止非法类型和未启用模型', () => {
  const model = new RulesModel({ supports_supplement: true, rules: {
    generate: { base: '快照', supplement: '旧补充' }, review: { supplement: '审核补充' },
  } });
  const owner = { rules: model };
  assert.equal(model.setSupplement('generate', '新补充'), model);
  assert.equal(owner.rules.rules.generate.supplement, '新补充');
  assert.equal(model.rules.generate.base, '快照');
  assert.equal(model.rules.review.supplement, '审核补充');
  assert.throws(() => model.setSupplement('other', ''), { code: 'INVALID_RULES', path: 'action' });
  assert.throws(() => model.setSupplement('generate', null), { code: 'INVALID_RULES' });
  assert.throws(() => new RulesModel().setSupplement('generate', ''), { code: 'INVALID_RULES', path: 'supports_supplement' });
});
