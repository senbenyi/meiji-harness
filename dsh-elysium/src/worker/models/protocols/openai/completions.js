// 职责：通过 OpenAI 兼容接口获取符合 JSON Schema 的结构化文本。
import { runtimeConfig } from '../../../../config.js'

const failure = (message, status = 502) => Object.assign(new Error(message), { status })

export async function completeStructured(settings, request, { fetcher = fetch, signal } = {}) {
  const key = settings.api_key_env && (runtimeConfig()[settings.api_key_env] || process.env[settings.api_key_env])
  if (settings.api_key_env && !key) throw failure(`缺少凭据环境变量：${settings.api_key_env}`, 503)
  const llm = request.llm || {}
  const maxTokens = Number.isInteger(llm.max_tokens) && llm.max_tokens > 0 ? Math.min(llm.max_tokens, 32768) : 4096
  const timeout = Number.isInteger(llm.timeout_ms) && llm.timeout_ms > 0 ? Math.min(llm.timeout_ms, 600000) : 120000
  const temperature = typeof llm.temperature === 'number' && llm.temperature >= 0 && llm.temperature <= 2 ? llm.temperature : 0.4
  let response
  try {
    response = await fetcher(`${settings.base_url.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', signal: signal || AbortSignal.timeout(timeout), headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model: settings.model, messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.user }],
        temperature, max_tokens: maxTokens, response_format: { type: 'json_schema', json_schema: { name: request.name, strict: true, schema: request.schema } } }),
    })
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') throw failure('结构化文本生成超时', 504)
    throw failure(`无法连接结构化文本生成服务：${error.message}`, 503)
  }
  if (!response.ok) throw failure(`结构化文本生成失败：HTTP ${response.status}`)
  const value = await response.json().catch(() => { throw failure('结构化文本生成响应无效') })
  const content = value.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) throw failure('结构化文本生成未返回内容')
  try { return JSON.parse(content) }
  catch { throw failure('结构化文本生成未返回有效 JSON') }
}
