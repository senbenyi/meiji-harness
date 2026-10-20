function invalid(path, message) {
  throw Object.assign(new TypeError(`${path}：${message}`), { code: 'INVALID_SETTINGS', path });
}

function plain(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function optionsOf(list, path) {
  if (!Array.isArray(list) || !list.length) invalid(path, '需为非空选项');
  const seen = new Set();
  for (const [index, option] of list.entries()) {
    if (!plain(option) || typeof option.value !== 'string' || !option.value || typeof option.label !== 'string' || !option.label) {
      invalid(`${path}.${index}`, '需包含 value 与 label');
    }
    if (seen.has(option.value)) invalid(`${path}.${index}.value`, '选项重复');
    seen.add(option.value);
  }
  return list;
}

function purposeOf(entry, purpose) {
  if (!plain(entry)) invalid(`spec.models.${purpose}`, '需为普通对象');
  const options = optionsOf(entry.options, `spec.models.${purpose}.options`);
  if (Object.hasOwn(entry, 'default') && !options.some(option => option.value === entry.default)) {
    invalid(`spec.models.${purpose}.default`, '不在选项内');
  }
  const legacy = entry.legacy ?? {};
  if (!plain(legacy)) invalid(`spec.models.${purpose}.legacy`, '需为普通对象');
  for (const [from, to] of Object.entries(legacy)) {
    if (typeof to !== 'string' || !options.some(option => option.value === to)) invalid(`spec.models.${purpose}.legacy.${from}`, '目标不在选项内');
  }
  return { options, default: entry.default, legacy };
}

/** 按调用方目录校验语言和各用途的模型选择。目录与业务名称由调用方提供。 */
export class SettingsModel {
  #data;

  constructor(value = {}, spec) {
    if (!plain(spec) || !plain(spec.models) || !Object.keys(spec.models).length) invalid('spec.models', '至少声明一个用途');
    const data = {};
    if (spec.language) {
      if (!plain(spec.language)) invalid('spec.language', '需为普通对象');
      const field = spec.language.field || 'output_language';
      const options = optionsOf(spec.language.options, 'spec.language.options');
      if (!options.some(option => option.value === spec.language.default)) invalid('spec.language.default', '不在选项内');
      const language = value?.[field] ?? spec.language.default;
      if (!options.some(option => option.value === language)) {
        throw Object.assign(new TypeError('请选择有效语言'), { code: 'INVALID_SETTINGS', path: field });
      }
      data[field] = language;
    }
    for (const purpose of Object.keys(spec.models)) {
      const entry = purposeOf(spec.models[purpose], purpose);
      const raw = value?.[purpose]?.model;
      const model = entry.legacy[raw] || raw || entry.default;
      if (!entry.options.some(option => option.value === model)) invalid(purpose, '请选择有效模型');
      data[purpose] = { model };
    }
    this.#data = data;
    Object.assign(this, structuredClone(data));
  }

  toJSON() {
    return structuredClone(this.#data);
  }
}
