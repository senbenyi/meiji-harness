import { runWithLogPurpose } from '../flow/session-log.js'
import { skillSupplement } from '../data/custom-skills.js'
import { withReviewPrompt } from '../data/self-checks.js'
import { loadSkill } from '../../skills/load.js'
import { languageInstruction } from '../data/language.js'
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

export async function askSkill(skillName, prompt, { project, includeReview = true, ...options }) {
  const json = ['skill-gailan-episode-generate', 'skill-juqing-outline-generate', 'skill-gongyong-content-review'].includes(skillName)
  const input = prompt + skillSupplement(project, skillName)
  const freeText = ['skill-jingtou-jingtoubiao-table-generate', 'skill-jingtou-jingtoubiao-shot-review', 'skill-jingtou-meimiao-seconds-generate', 'skill-jingtou-wenben-storyboard-generate'].includes(skillName)
  const purpose = options.logPurpose || skillLogPurpose(skillName)
  return runWithLogPurpose(`${purpose}${options.logStage ? '·' + options.logStage : ''}`, () => askModel({ ...options, json: options.json ?? json, system: loadSkill(skillName).content + (freeText ? '\n本阶段只返回自由文本正文，禁止 JSON 包装。镜头表按要求用标题提供编号和可变时长，程序只读取标题元数据；其余阶段沿用已存编号和时长。剧情正文不解析字段，素材列表由程序管理。此输出协议优先于官方参考中的示例格式。' : '') + (options.json === false && skillName === 'skill-gongyong-content-review' ? '\n本次审核协议覆盖上文 JSON 输出协议：待审资料为原文，不解析 JSON、不检查字段；只审核语义。首行只写 PASS 或 FAIL，后续用项目语言写明确问题。没有问题只返回 PASS。' : '') + '\n\n' + languageInstruction(project) + '\n若任务要求 JSON：只输出完整合法 JSON 对象。字符串内双引号、反斜杠和换行必须转义；对白优先用中文引号「」或单引号，禁止 Markdown 围栏、注释和尾随逗号。', prompt: includeReview ? withReviewPrompt(input) : input }))
}
