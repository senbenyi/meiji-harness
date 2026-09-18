// 职责：校验手工登记的服务器清单与不可变连接身份，不保存平台凭据。
export const fail = message => { throw Object.assign(new Error(message), { status: 400 }) }
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const keys = (value, allowed) => {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('服务器配置字段无效')
}
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)
const port = value => Number.isInteger(value) && value > 0 && value <= 65535
export function httpUrl(value) {
  let url
  try { url = new URL(value) } catch { fail('服务地址必须为 HTTP(S) URL') }
  if (typeof value !== 'string' || /\s/.test(value) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.port === '0') fail('服务 URL 不能包含凭据、查询参数或无效端口')
  return url.href.replace(/\/+$/, '')
}
export function serviceUrl(service) {
  return service.transport === 'http' ? httpUrl(service.base_url)
    : httpUrl(`http://127.0.0.1:${service.local_port}${service.api_path || ''}`)
}
export function validateRegistry(value) {
  keys(value, ['version', 'revision', 'active', 'third_party', 'servers'])
  if (value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.servers)) fail('服务器配置版本无效')
  if (value.active !== undefined) keys(value.active, ['comfyui', 'llm', 'analysis', 'image', 'video'])
  if (value.third_party !== undefined) {
    keys(value.third_party, ['image', 'video'])
    if (Object.values(value.third_party).some(value => !/^[a-z][a-z0-9_-]{0,63}:[A-Za-z0-9_-]+$/.test(value))) fail('三方模型选择无效')
  }
  const ids = new Set(), ports = new Set(), endpoints = new Set(), identities = new Set()
  for (const server of value.servers) {
    keys(server, ['id', 'label', 'provider', 'connection_source', 'instance_id', 'deployment_id', 'disabled', 'services'])
    if (!id(server.id) || ids.has(server.id)) fail('服务器 ID 无效或重复')
    ids.add(server.id)
    if (typeof server.label !== 'string' || !server.label.trim() || server.label.length > 120) fail('服务器名称无效')
    if (typeof server.provider !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(server.provider) || server.connection_source !== 'manual') fail('仅支持手工登记服务器')
    if (!id(server.instance_id) || !id(server.deployment_id)) fail('必须提供实例与部署身份')
    const identity = `${server.provider}:${server.instance_id}:${server.deployment_id}`
    if (identities.has(identity)) fail('实例部署身份重复')
    identities.add(identity)
    if (server.disabled !== undefined && typeof server.disabled !== 'boolean') fail('disabled 必须为布尔值')
    keys(server.services, ['comfyui', 'llm'])
    if (!Object.keys(server.services).length) fail('至少登记一种服务')
    for (const [kind, service] of Object.entries(server.services)) {
      keys(service, ['transport', 'base_url', 'ssh_alias', 'remote_host', 'remote_port', 'local_port', 'api_path', 'model', 'api_key_env', 'workload', 'ssh_identity'])
      if (service.transport === 'http') {
        httpUrl(service.base_url)
        if (['ssh_alias', 'remote_host', 'remote_port', 'local_port', 'api_path', 'ssh_identity'].some(key => service[key] !== undefined)) fail('HTTP 服务不能包含 SSH 字段')
      } else if (service.transport === 'ssh') {
        if (!/^[a-f0-9]{64}$/.test(service.ssh_identity || '')) fail('SSH 服务必须记录解析身份，请通过服务器设置登记')
        if (service.base_url !== undefined || !id(service.ssh_alias) || !/^[A-Za-z0-9.:-]+$/.test(service.remote_host || '') || !port(service.remote_port) || !port(service.local_port)) fail('SSH 地址或端口无效')
        if (ports.has(service.local_port)) fail('不同服务必须使用独立本地端口')
        ports.add(service.local_port)
        if (service.api_path !== undefined && !/^\/[A-Za-z0-9/_-]*$/.test(service.api_path)) fail('api_path 无效')
      } else fail('未知连接类型')
      const endpoint = serviceUrl(service)
      if (endpoints.has(endpoint)) fail('服务地址重复，不能映射多个身份')
      endpoints.add(endpoint)
      if (service.api_key_env !== undefined && !/^[A-Z_][A-Z0-9_]*$/.test(service.api_key_env)) fail('只允许环境变量凭据引用')
      if (kind === 'comfyui' && (typeof service.workload !== 'string' || !service.workload)) fail('需要 ComfyUI 工作流能力标识')
      if (kind === 'llm' && (typeof service.model !== 'string' || !service.model)) fail('需要 LLM 模型标识')
    }
  }
  for (const [kind, selected] of Object.entries(value.active || {})) {
    if (selected === null) continue
    const server = value.servers.find(item => item.id === selected)
    if (!server?.services[['image', 'video'].includes(kind) ? 'comfyui' : kind === 'analysis' ? 'llm' : kind] || server.disabled) fail(`默认 ${kind} 目标不存在或已停用`)
  }
  return value
}
export const serverIdentity = server => JSON.stringify([server.provider, server.instance_id, server.deployment_id, server.connection_source,
  Object.entries(server.services).sort().map(([kind, service]) => [kind, Object.entries(service).sort()])])
