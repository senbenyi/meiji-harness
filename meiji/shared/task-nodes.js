// 任务节点模板（前后端共用）：任务创建时只放基础节点；自审不通过时按轮次动态追加「修订 → 复审」。
// 修订上限 maxRevisions 由每个任务定义独立配置，未配置时为 DEFAULT_MAX_REVISIONS。

export const DEFAULT_MAX_REVISIONS = 2

// 文本任务的基础节点：生成 → 自审。修订与复审不预先放入，按需追加。
export const textNodes = target => ['generate', 'review'].map(kind => ({ kind, target }))

// 第 round 轮修订追加的两个节点。
export const revisionRound = (target, round) => ['revise', 're_review'].map(kind => ({ kind, target, round }))

export const isRevisionKind = kind => kind === 'revise' || kind === 're_review'

// 同一目标已追加的修订轮数（以修订节点计）。
export const revisionRounds = (nodes = [], target = null) => nodes.filter(node => node.kind === 'revise' && (node.target ?? null) === (target ?? null)).length

// 修订上限：任务定义的值为非负整数时采用，否则用默认值。
export function maxRevisionsOf(value) {
  return Number.isInteger(value) && value >= 0 ? value : DEFAULT_MAX_REVISIONS
}

// 节点显示名中的轮次后缀：第 1 轮也标出，便于与上限对照。
export const roundSuffix = node => (isRevisionKind(node?.kind) && Number.isInteger(node.round) ? `·第${node.round}轮` : '')
