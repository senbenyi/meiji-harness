// 文本步骤的修订轮次规则（前后端共用）。
export const DEFAULT_MAX_REVISIONS = 2
export const isRevisionKind = kind => kind === 'revise' || kind === 're_review'

// 修订上限：为非负整数时采用，否则用默认值。
export function maxRevisionsOf(value) {
  return Number.isInteger(value) && value >= 0 ? value : DEFAULT_MAX_REVISIONS
}

// 显示名中的轮次后缀：第 1 轮也标出，便于与上限对照。
export const roundSuffix = node => (isRevisionKind(node?.kind) && Number.isInteger(node.round) ? `·第${node.round}轮` : '')
