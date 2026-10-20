import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { SettingsModel } from './index.js'

function invalid(path, message) {
  throw Object.assign(new TypeError(`${path}：${message}`), { code: 'INVALID_SETTINGS', path })
}

function documentOf(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('file', '需为对象')
  return value
}

// 选择字段以 SettingsModel 为准，其余字段原样保留。
function normalize(value, spec) {
  const source = documentOf(value)
  return { ...source, ...new SettingsModel(source, spec).toJSON() }
}

async function readRaw(file, defaults) {
  try { return documentOf(JSON.parse(await readFile(file, 'utf8'))) }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
    const fallback = typeof defaults === 'function' ? await defaults() : structuredClone(defaults)
    return documentOf(fallback)
  }
}

/** 把设置写到本地 JSON。缺文件时使用 defaults；写入先落临时文件再替换，权限为 0600。 */
export function createSettingsStore(file, { spec, defaults = {} } = {}) {
  if (typeof file !== 'string' || !file.trim()) invalid('file', '需为文件路径')
  return {
    async read() {
      return normalize(await readRaw(file, defaults), spec)
    },
    async write(value) {
      const next = normalize({ ...await readRaw(file, defaults), ...documentOf(value) }, spec)
      await mkdir(dirname(file), { recursive: true })
      const temporary = `${file}.tmp`
      await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
      await rename(temporary, file)
      await chmod(file, 0o600)
      return next
    },
  }
}
