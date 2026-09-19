// 职责：校验新任务使用的私有与三方模型选择，不处理文件读写。
const fail = message => { throw Object.assign(new Error(message), { status: 400 }) }
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)
const thirdPartyId = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,63}:[A-Za-z0-9_-]+$/.test(value)

export function validateSelection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['version', 'revision', 'selected', 'third_party'].includes(key))
    || value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0) fail('Elysium 选择配置版本无效')
  for (const [field, check] of [['selected', id], ['third_party', thirdPartyId]]) {
    const entries = value[field]
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)
      || Object.keys(entries).some(key => !['image', 'video'].includes(key))
      || Object.values(entries).some(item => item !== null && !check(item))) fail('Elysium 模型选择无效')
  }
  return value
}
