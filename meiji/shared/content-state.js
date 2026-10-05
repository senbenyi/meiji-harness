// 内容节点状态转换（服务端唯一入口）：摘要、大纲、镜头等内容节点及剧集、项目聚合状态只经这里修改。
// 节点构造与 setContent / begin / finish / modelPatch 等基础函数在 drama-model.js；本文件集中其余转换，保证同一转换只有一种写法。
//
// | 转换 | 场景 | 结果 |
// |---|---|---|
// | markGenerating | 任务进入生成/审核阶段 | 生成中，可更新 operation.phase |
// | markFailed | 执行失败、停止、重启取消、放弃候选图 | 未通过，记录错误，释放所属操作 |
// | markPassed | 人工保存摘要、人工放行、尾帧提取成功 | 已通过，结论为通过，清除错误 |
// | markPendingReview | 人工编辑后等待审核 | 结论清空；不在执行中时为未生成 |
// | statusFromCheck | 写入审核结论后 | 结论通过为已通过，否则未通过 |
// | settleByCheck | 任务结束释放节点 | 按结论落定，清除错误并释放操作 |
// | refreshEpisodeStatus / refreshProjectStatus | 节点变化后 | 重新计算剧集 / 项目聚合状态 |
import { GenerationStatus, aggregateStatus, modelPatch } from './drama-model.js'

export function markGenerating(target, phase) {
  target.status = GenerationStatus.GENERATING
  if (phase && target.operation) target.operation.phase = phase
  return target
}

export function markFailed(target, error) {
  target.status = GenerationStatus.FAILED
  target.error = String(error || '执行失败')
  target.operation = null
  return target
}

export function markPassed(target, extra = {}) {
  target.check = { passed: true, failures: [], revision: target.revision, ...extra }
  target.status = GenerationStatus.PASSED
  target.error = null
  return target
}

export function markPendingReview(target) {
  target.check = { passed: null, failures: [], revision: target.revision }
  if (!target.operation) target.status = GenerationStatus.NOT_GENERATED
  return target
}

export function statusFromCheck(target) {
  target.status = target.check?.passed === true ? GenerationStatus.PASSED : GenerationStatus.FAILED
  return target
}

export function settleByCheck(target) {
  target.operation = null
  target.error = null
  return statusFromCheck(target)
}

export function refreshEpisodeStatus(episode) {
  episode.status = modelPatch(episode, {}).status
  return episode
}

export function refreshProjectStatus(project) {
  project.status = aggregateStatus(project.episodes || [])
  return project
}

// 新建项目：项目未生成；创建时填写的总摘要视为已通过。
export function initialProjectStates(summaryNode) {
  return { status: GenerationStatus.NOT_GENERATED, summary: summaryNode.content ? markPassed(summaryNode) : markPendingReview(summaryNode) }
}
