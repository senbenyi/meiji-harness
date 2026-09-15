// 职责：在 Harness 启动前将待生效 LLM 选择应用到原有 Qwen 路由，保留其他 settings 字段。
import { readFile, writeFile, rename, rm, open } from 'node:fs/promises'
import { existsSync, realpathSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { backendLlmSettings } from '../../dsh-elysium/src/servers/runtime.js'
import { resolveServer } from '../../dsh-elysium/src/servers/resolve.js'
import { readRegistry } from '../../dsh-elysium/src/servers/store.js'
export function installedYaml() {
  const executable = (process.env.PATH || '').split(delimiter).map(directory => join(directory, 'dsh')).find(path => existsSync(path))
  if (!executable) throw new Error('请先安装本机 Harness')
  return createRequire(realpathSync(executable))('yaml')
}
export async function applyLlmSelection(home, { yaml, processes = () => execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }) } = {}) {
  const registry = readRegistry()
  if (!registry?.active.llm) return null
  // settings 会被宿主热读取；任何仍运行的 dsh 都阻止本脚本写入，避免中途换模型。
  if (processes().split('\n').some(line => /(?:\/dsh(?:\/lib\/bin\.js)?|\bdsh)\s+(?:web|run|chat)\b/.test(line))) throw new Error('仍有 Harness 进程运行，请先停止后再应用 LLM 选择')
  const backend = resolveServer('llm')
  const settings = await backendLlmSettings(backend)
  const path = join(home, 'settings.yaml')
  const lock = await open(`${path}.servers.lock`, 'wx', 0o600)
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const text = await readFile(path, 'utf8'), document = (yaml || installedYaml()).parseDocument(text)
    if (document.errors.length) throw new Error('settings.yaml 解析失败，未修改配置')
    const provider = ['llm-pi-ai', 'providers', settings.route], existing = document.getIn(provider)?.toJSON()
    if (existing?.api !== settings.api || !existing.models?.some(model => model.id === settings.model)) throw new Error('现有 Qwen 路由不兼容，未修改 settings')
    if (existing.headers && Object.keys(existing.headers).length) throw new Error('现有 Qwen 路由包含自定义 headers，请先核对凭据来源后再切换')
    document.setIn([...provider, 'baseURL'], settings.base_url)
    if (settings.api_key_env) document.setIn([...provider, 'apiKeyEnv'], settings.api_key_env)
    else document.deleteIn([...provider, 'apiKeyEnv'])
    // 该路由由清单决定凭据来源，不能继续混用之前的其他凭据字段。
    for (const field of ['apiKey', 'apiKeyRef']) document.deleteIn([...provider, field])
    document.setIn(['agent-default-model', 'provider'], settings.route)
    document.setIn(['agent-default-model', 'model'], settings.model)
    await writeFile(temporary, document.toString(), { mode: 0o600 })
    if (await readFile(path, 'utf8') !== text) throw new Error('settings 已被修改，请重新启动以重试')
    await rename(temporary, path)
    return backend
  } finally { await rm(temporary, { force: true }); await lock.close(); await rm(`${path}.servers.lock`, { force: true }) }
}
