import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, realpath, copyFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, posix } from 'node:path'
import { requiredConfig } from '../config.js'
import { sha256File } from '../functions/common/file-hash.js'
import { ModelTaskError } from '../jobs/contracts.js'

const run = promisify(execFile)
const invalid = message => new ModelTaskError('MODEL_INPUT_INVALID', `[MODEL_INPUT_INVALID] ${message}`, 422)
const within = (root, path) => { const rel = relative(root, path); return rel && rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel) }

export async function resolveVideoPlan(args, signal, fetchRemote = async (host, path, target) => {
  await run('scp', ['-q', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', `${host}:${path}`, target],
    { signal, timeout: 600_000, maxBuffer: 1024 * 1024 })
}) {
  if (!Object.hasOwn(args, 'plan_path')) return args
  if (Object.keys(args).length !== 1 || typeof args.plan_path !== 'string') throw invalid('plan_path 必须单独使用，不能覆盖分镜文件中的字段')
  const source = args.plan_path
  let host, sourcePath
  if (source.startsWith('ssh://')) {
    const match = /^ssh:\/\/([A-Za-z0-9][A-Za-z0-9_.-]*)(\/[A-Za-z0-9_./-]+\.json)$/.exec(source)
    if (!match || match[2].split('/').includes('..')) throw invalid('远端分镜须为 ssh://服务器别名/绝对路径.json，不接受凭据或命令字符')
    host = match[1]
    sourcePath = match[2]
  } else {
    if (!isAbsolute(source) || !source.endsWith('.json')) throw invalid('本地分镜须为 artifacts 内的绝对 JSON 路径')
    sourcePath = await realpath(source)
    if (!within(await realpath(requiredConfig('ARTIFACTS_ROOT')), sourcePath)) throw invalid('本地分镜必须位于 artifacts 内')
  }
  const parent = dirname(sourcePath)
  const root = join(requiredConfig('ARTIFACTS_ROOT'), 'plans')
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'director-'))
  const original = join(directory, 'source-plan.json')
  if (host) await fetchRemote(host, sourcePath, original)
  else await copyFile(sourcePath, original)
  let plan
  try { plan = JSON.parse(await readFile(original, 'utf8')) } catch { throw invalid('分镜文件不是有效 JSON') }
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) || 'plan_path' in plan) throw invalid('分镜文件须为普通视频请求，不能嵌套 plan_path')
  const assets = new Map()
  const localize = async value => {
    if (typeof value !== 'string' || !value) throw invalid('参考素材路径不能为空')
    const path = host ? posix.resolve(parent, value) : await realpath(resolve(parent, value))
    if (!within(parent, path) || (host && !/^\/[A-Za-z0-9_./-]+$/.test(path))) throw invalid('分镜素材必须位于分镜文件所在目录内')
    if (assets.has(path)) return assets.get(path).local_path
    if (host) {
      const remote = `ssh://${host}${path}`
      assets.set(path, { source_path: path, local_path: remote })
      return remote
    }
    const target = join(directory, `asset-${assets.size}${posix.extname(path).toLowerCase()}`)
    if (host) await fetchRemote(host, path, target)
    else await copyFile(path, target)
    assets.set(path, { source_path: path, local_path: target, sha256: await sha256File(target) })
    return target
  }
  for (const object of [plan, ...(Array.isArray(plan.shots) ? plan.shots : [])]) {
    if (!object || typeof object !== 'object') continue
    for (const key of ['image_path', 'video_path', 'audio_path']) if (key in object) object[key] = await localize(object[key])
  }
  if (Array.isArray(plan.video_paths)) for (let i = 0; i < plan.video_paths.length; i++) plan.video_paths[i] = await localize(plan.video_paths[i])
  await writeFile(join(directory, 'source.json'), JSON.stringify({ plan_path: source,
    plan_sha256: await sha256File(original), assets: [...assets.values()] }, null, 2) + '\n')
  return plan
}
