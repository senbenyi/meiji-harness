import test from 'node:test';
import assert from 'node:assert/strict';
import { SettingsModel } from '../src/index.js';

const spec = {
  language: {
    field: 'output_language',
    default: 'zh-CN',
    options: [{ value: 'zh-CN', label: '简体中文' }, { value: 'en', label: 'English' }],
  },
  models: {
    session: { options: [{ value: 'local', label: '本地' }, { value: 'remote', label: '远程' }], default: 'remote' },
    draft: { options: [{ value: 'local', label: '本地' }, { value: 'remote', label: '远程' }] },
    picture: { options: [{ value: 'poster', label: '海报' }], default: 'poster', legacy: { 'old-poster': 'poster' } },
  },
};

test('缺省语言和带默认值的用途自动补齐，其余用途必须显式选择', () => {
  const model = new SettingsModel({ draft: { model: 'local' } }, spec);
  assert.equal(model.output_language, 'zh-CN');
  assert.equal(model.session.model, 'remote');
  assert.equal(model.draft.model, 'local');
  assert.equal(model.picture.model, 'poster');
  assert.deepEqual(JSON.parse(JSON.stringify(model)), model.toJSON());
  assert.deepEqual(new SettingsModel(model.toJSON(), spec).toJSON(), model.toJSON());
});

test('旧值按该用途映射，未知选择和其他用途的值被拒绝', () => {
  assert.equal(new SettingsModel({ draft: { model: 'remote' }, picture: { model: 'old-poster' } }, spec).picture.model, 'poster');
  assert.throws(() => new SettingsModel({ output_language: 'fr', draft: { model: 'local' } }, spec), { code: 'INVALID_SETTINGS', path: 'output_language', message: '请选择有效语言' });
  assert.throws(() => new SettingsModel({ draft: { model: 'poster' } }, spec), { code: 'INVALID_SETTINGS', path: 'draft', message: 'draft：请选择有效模型' });
  assert.throws(() => new SettingsModel({}, spec), { code: 'INVALID_SETTINGS', path: 'draft' });
});

test('序列化结果与输入互不共享，空模型名回落到默认值', () => {
  const input = { session: { model: '' }, draft: { model: 'local' }, picture: { model: 'poster' }, extra: true };
  const model = new SettingsModel(input, spec);
  model.draft.model = 'remote';
  assert.equal(model.toJSON().draft.model, 'local');
  assert.equal(input.session.model, '');
  assert.equal(model.session.model, 'remote');
  assert.equal(Object.hasOwn(model.toJSON(), 'extra'), false);
});

test('目录本身不合法时直接失败', () => {
  assert.throws(() => new SettingsModel({}, {}), { path: 'spec.models' });
  assert.throws(() => new SettingsModel({}, { models: { draft: { options: [] } } }), { path: 'spec.models.draft.options' });
  assert.throws(() => new SettingsModel({}, { models: { draft: { options: [{ value: 'a', label: 'A' }, { value: 'a', label: '重复' }] } } }), { path: 'spec.models.draft.options.1.value' });
  assert.throws(() => new SettingsModel({}, { models: { draft: { options: [{ value: 'a', label: 'A' }], default: 'missing' } } }), { path: 'spec.models.draft.default' });
  assert.throws(() => new SettingsModel({}, { models: { draft: { options: [{ value: 'a', label: 'A' }], legacy: { old: 'missing' } } } }), { path: 'spec.models.draft.legacy.old' });
});
