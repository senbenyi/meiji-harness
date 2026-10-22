import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { createLibraryStore } from '../../library/library_store.js'

export function scriptSourceInfo(body, originalName = '') {
  if (typeof body !== 'string' || Buffer.byteLength(body) > 1024 * 1024) throw new TypeError('剧本需为不超过1MB的文本')
  if (!body.trim()) return { original_script_file_path: '' }
  originalName ||= '剧本.txt'
  if (typeof originalName !== 'string' || originalName.length > 200 || /[\\/\x00-\x1f]/.test(originalName) || !/\.(txt|text|md)$/i.test(originalName)) throw new TypeError('请选择TXT或Markdown剧本文件')
  const hash = createHash('sha256').update(body).digest('hex')
  return { original_script_file_path: `sources/${hash}/${originalName}` }
}

/** 原稿只作为沙盒来源文件；正文工作副本由script_revision持有。 */
export async function saveProjectScript(root, projectId, { body, originalName }) {
  const source = scriptSourceInfo(body, originalName)
  if (!source.original_script_file_path) return source
  originalName = source.original_script_file_path.split('/').at(-1)
  const projectRoot = resolve(root, 'projects', projectId), file = join(projectRoot, source.original_script_file_path)
  await mkdir(join(file, '..'), { recursive: true, mode: 0o700 })
  const parent = await realpath(join(file, '..'))
  if (!parent.startsWith((await realpath(projectRoot)) + sep)) throw new Error('原稿路径超出项目沙盒')
  try { await writeFile(file, body, { flag: 'wx', mode: 0o600 }) }
  catch (error) {
    if (error.code !== 'EEXIST') throw error
    if (await readProjectScript(root, projectId, source.original_script_file_path) !== body) throw new Error('原稿文件内容冲突')
  }
  const library = createLibraryStore(root)
  let found = false
  for (const asset of await library.list()) if (asset.category === 'scripts' && asset.originalName === originalName && await library.readScript(asset.id) === body) { found = true; break }
  if (!found) await library.importScript({ originalName, body })
  return source
}

export async function readProjectScript(root, projectId, reference) {
  if (typeof reference !== 'string' || !/^sources\/[a-f0-9]{64}\/[^/\\\x00-\x1f]+\.(txt|text|md)$/i.test(reference)) throw new TypeError('原稿路径无效')
  const projectRoot = await realpath(resolve(root, 'projects', projectId)), file = await realpath(join(projectRoot, reference))
  if (!file.startsWith(projectRoot + sep)) throw new Error('原稿路径超出项目沙盒')
  return readFile(file, 'utf8')
}
