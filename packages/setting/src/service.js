import { createSettingsStore } from './store.js'

/** 项目传目录/默认值与宿主回调；保存字段与选择在回调和落盘前验证。 */
export function createSettingsService({ file, spec, defaults = {}, allowedFields, beforeSave } = {}) {
  if (beforeSave !== undefined && typeof beforeSave !== 'function') throw new TypeError('beforeSave需为函数')
  const fields = allowedFields ?? [...(spec?.language ? [spec.language.field || 'output_language'] : []), ...Object.keys(spec?.models || {})]
  if (!Array.isArray(fields) || fields.some(field => typeof field !== 'string' || !field)) throw new TypeError('allowedFields需为字段名数组')
  const allowed = new Set(fields)
  const store = createSettingsStore(file, { spec, defaults })
  return {
    read: () => store.read(),
    async save(patch) {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('设置修改需为对象')
      for (const key of Object.keys(patch))
        if (!allowed.has(key)) throw new TypeError('未知设置字段：' + key)
      return store.write(patch, { beforeWrite: beforeSave })
    },
  }
}
