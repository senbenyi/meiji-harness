// 职责：解析安装根目录、验证实体媒体，并只初始化目标端缺失的存储单元。
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { cp, lstat, mkdir, readFile, readdir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path'

export function dshHome(value = process.env.DSH_HOME) {
  if (value === undefined) return join(homedir(), '.dsh')
  if (!value.trim() || !isAbsolute(value) || resolve(value) === parse(value).root || resolve(value) === homedir()) throw new Error('DSH_HOME 必须为独立的绝对目录，不能是根目录或用户主目录')
  return resolve(value)
}

export async function verifyMedia(root) {
  const projects = join(root, 'projects'), manifests = []
  for (const entry of await readdir(projects, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const project = join(projects, entry.name), manifestPath = join(project, 'media', 'manifest.json')
    let manifest
    try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')) }
    catch (error) { if (error.code === 'ENOENT') continue; throw error }
    if (manifest.project_id !== entry.name) throw new Error('模板媒体项目归属无效')
    for (const record of manifest.files) {
      if (!record.path.startsWith('media/') || record.path.split('/').some(part => part === '..') || /[%\\]/.test(record.path)) throw new Error('模板媒体路径无效')
      const path = await realpath(join(project, record.path)), location = relative(await realpath(project), path)
      if (location === '..' || location.startsWith(`..${sep}`) || isAbsolute(location)) throw new Error('模板媒体路径越界')
      const hash = createHash('sha256'); let size = 0, first = true
      for await (const chunk of createReadStream(path)) {
        if (first && chunk.toString('utf8', 0, 100).startsWith('version https://git-lfs.github.com/spec/v1')) throw new Error(`Git LFS 媒体尚未实体化：${record.path}；请先运行 git lfs pull`)
        first = false; size += chunk.length; hash.update(chunk)
      }
      if (size !== record.size_bytes || hash.digest('hex') !== record.sha256) throw new Error(`模板媒体校验失败：${record.path}`)
    }
    manifests.push(manifest)
  }
  return manifests
}

async function exists(path) {
  try { await lstat(path); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error }
}

// 每个项目是包含 JSON、任务、生产记录与媒体的不可覆盖初始化单元。
export async function installStorage(source, target) {
  await mkdir(target, { recursive: true })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('存储模板不允许符号链接')
    const destination = join(target, entry.name)
    if (!await exists(destination)) { await cp(join(source, entry.name), destination, { recursive: true, force: false, errorOnExist: true }); continue }
    if ((await lstat(destination)).isSymbolicLink()) throw new Error('目标存储不允许符号链接')
    if (entry.isDirectory() && ['projects', 'runtime'].includes(entry.name)) {
      for (const child of await readdir(join(source, entry.name))) {
        if (!await exists(join(destination, child))) await cp(join(source, entry.name, child), join(destination, child), { recursive: true, force: false, errorOnExist: true })
      }
    }
  }
}
