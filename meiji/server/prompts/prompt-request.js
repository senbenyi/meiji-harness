// 统一的文本请求结构。所有文本步骤（摘要、剧情四类、镜头表、每秒指令、单镜修订、图片提示词改写、文本分镜审核）
// 都按同一顺序组装三类请求，各步骤只提供内容：
//   system：角色 → 任务范围 → 规则（生成/修订用生产规则，审核用审核方式与审核标准）→ 本节点补充 → 指导素材规则
//           →（修订范围）→ 语言 → 正文结构 → 输出协议（写明输出什么并附示例）
//   user：  阶段 → 本次任务 → 本次生成要求 → 上游事实与上下文 → 指导素材 → 基稿与意见 → 审核上下文 → 待审内容 → 审核收尾
import { segment } from './skill-prompts.js'
import { checkContext } from '../runtime/operation-context.js'

const list = value => (Array.isArray(value) ? value : [value]).filter(Boolean)

// 调用方的任务资料：{ task, review, facts: [{ title, text }] }；字符串视为只有任务说明。
// task 是生成/修订的任务说明；review 是审核目标（缺省时使用步骤默认的审核目标，不复用生成指令）。
export function taskInput(instructions) {
  if (instructions && typeof instructions === 'object') return { task: instructions.task || '', review: instructions.review || '', facts: instructions.facts || [] }
  return { task: String(instructions || ''), review: '', facts: [] }
}

export const factSegments = facts => (facts || []).map(fact => segment('context', fact.title || '', fact.text))

// 本次操作附带的生成要求，生成、修订、审核都单独成段，不再拼进任务文本。
export const requirementSegment = (requirements = checkContext.getStore()?.requirements) => segment('context', '【本次生成要求】', requirements || '')

export function baseSegments({ kind, baseContent = '', opinion = '', humanOpinion = '', automatic = false }) {
  if (kind === 'review') return [
    segment('context', '【修订基稿（用于对照范围）】', baseContent),
    segment('context', automatic ? '【本轮修订意见】' : '【本次修改意见】', opinion),
    ...(automatic ? [segment('context', '【本次修改意见】', humanOpinion)] : []),
  ]
  if (kind === 'generate') return [segment('context', '【本次修改意见】', opinion)]
  return [
    segment('context', automatic ? '【最新失败稿（唯一修改基准）】' : '【修改基稿】', baseContent),
    segment('context', automatic ? '【本轮自审不通过原因】' : '【本次修改意见】', opinion),
    ...(automatic ? [segment('context', '【本次修改意见】', humanOpinion)] : []),
  ]
}

export function generationRequest({ json = false, role, scope, rules, additions, assetRules, boundary, language, structure, protocol,
  task, requirements, facts, assets, base }) {
  return {
    json,
    system: [role, ...list(scope), ...list(rules), ...list(additions), ...list(assetRules), ...list(boundary), ...list(language), ...list(structure), ...list(protocol)],
    user: [...list(task), ...list(requirements), ...list(facts), ...list(assets), ...list(base)],
  }
}

export function reviewRequest({ role, scope, method, criteria, additions, assetRules, language, structure, protocol,
  stage, task, requirements, facts, assets, base, continuity, content, closing }) {
  return {
    json: true,
    system: [role, ...list(scope), ...list(method), ...list(criteria), ...list(additions), ...list(assetRules), ...list(language), ...list(structure), ...list(protocol)],
    user: [...list(stage), ...list(task), ...list(requirements), ...list(facts), ...list(assets), ...list(base), ...list(continuity), ...list(content), ...list(closing)],
  }
}
