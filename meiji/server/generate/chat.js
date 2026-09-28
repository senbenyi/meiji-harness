import { completeChat } from './gateway.js'

export function textMaxTokens(durationSeconds) {
  const duration = Number.isInteger(durationSeconds) && durationSeconds > 0 ? durationSeconds : 1
  return Math.min(32768, Math.max(16384, 4096 + duration * 128))
}


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

export async function askModel({ route, system, prompt, maxTokens, json = false, signal, fetchImpl, missing = '尚未配置剧情模型' }) {
  if (!route?.baseUrl || !route?.apiKey || !route?.model) throw Object.assign(new Error(missing), { status: 400 })
  return completeChat({ baseUrl: route.baseUrl, apiKey: route.apiKey, model: route.model, system, prompt, maxTokens, json, signal, fetchImpl })
}


export function skillLogPurpose(skillName) { return ({
    'skill-gailan-episode-generate': '本集剧情', 'skill-juqing-outline-generate': '剧情大纲',
    'skill-jingtou-jingtoubiao-table-generate': '镜头表', 'skill-jingtou-jingtoubiao-shot-review': '单镜修订',
    'skill-jingtou-meimiao-seconds-generate': '每秒指令', 'skill-jingtou-wenben-storyboard-generate': '文本分镜',
    'skill-gongyong-content-review': '内容自审',
  }[skillName] || skillName) }
