import { completeChat } from './gateway.js'
import { builtinSkill, isSkill } from '../../skills/load.js'

export function parseJsonValue(text) {
  const source = String(text || '').trim()
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(source)
  const body = (fenced ? fenced[1] : source).trim()
  const start = ['[', '{'].reduce((found, mark) => {
    const index = body.indexOf(mark)
    return index >= 0 && index < found ? index : found
  }, Infinity)
  if (!Number.isFinite(start)) throw Object.assign(new Error('模型没有返回 JSON'), { status: 502, code: 'INVALID_MODEL_JSON' })
  try { return JSON.parse(body.slice(start)) }
  catch (error) {
    const location = /position \d+(?: \(line \d+ column \d+\))?/.exec(error.message)?.[0]
    throw Object.assign(new Error(`JSON 无法解析${location ? `（${location}）` : ''}：请检查对象括号、逗号及字符串转义，返回完整合法 JSON`), { status: 502, code: 'INVALID_MODEL_JSON' })
  }
}

export async function askModel({ route, system, prompt, json = false, signal, fetchImpl, missing = '尚未配置剧情模型' }) {
  if (!route?.baseUrl || !route?.apiKey || !route?.model) throw Object.assign(new Error(missing), { status: 400 })
  return completeChat({ baseUrl: route.baseUrl, apiKey: route.apiKey, model: route.model, system, prompt, json, signal, fetchImpl })
}


// 会话日志用途：阶段技能的日志名（未知时原样返回）。
export function skillLogPurpose(stage) {
  return isSkill(stage) ? builtinSkill(stage).logLabel || stage : stage
}
