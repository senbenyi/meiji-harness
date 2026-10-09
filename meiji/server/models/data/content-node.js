// 内容节点的共同形状。剧情、镜头、每秒分镜和卡片都套这一层。
export const GenerationStatus = Object.freeze({
  NOT_GENERATED: 'not-generated',
  GENERATING: 'generating',
  PAUSED: 'paused',
  FAILED: 'failed',
  PASSED: 'passed',
})
export const statusLabels = Object.freeze({
  [GenerationStatus.NOT_GENERATED]: '未生成',
  [GenerationStatus.GENERATING]: '生成中',
  [GenerationStatus.PAUSED]: '暂停',
  [GenerationStatus.FAILED]: '未通过',
  [GenerationStatus.PASSED]: '已通过',
})
export const emptyCheck = () => ({ passed: null, failures: [], revision: null })
export const emptyReview = () => ({ text: '', revision: 0, history: [] })
export function node(id, content = null) {
  return { id, revision: 0, status: GenerationStatus.NOT_GENERATED, content, check: emptyCheck(), review: emptyReview(), draft: { text: null, revision: 0, baseRevision: null }, operation: null, error: null }
}
