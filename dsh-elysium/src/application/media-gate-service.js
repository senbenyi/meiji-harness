/**
 * 放行决策层：调用探针、按契约判定、落 receipt。
 *
 * 分层：探针在 infrastructure/media/probe.js，判定规则在 domain/media-gate.js，
 * 这里只负责编排这三件事并决定放不放行。
 *
 * 本插件的生产链路直连 ComfyUI，不经过 model API，因此这条路上没有远端 receipt
 * 可校验——每个产物的 receipt 都由本层生成，producedBy 记为 plugin-local。
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { CONTRACT } from '../domain/media-gate-contract.js'
import { evaluateMedia, mediaFailureSummary } from '../domain/media-gate.js'
import { probeMedia } from '../infrastructure/media/probe.js'
import { ElysiumError, writeJsonAtomic } from '../infrastructure/persistence/store.js'

const TASK_KINDS = {
  asset: ['image'],
  start_frame: ['image'],
  keyframe: ['image'],
  chapter: ['video'],
  final: ['video'],
  audio: ['video', 'audio'],
}

/** 产物的媒体类型，决定套用契约里的哪些规则。 */
export function artifactKinds(taskType) {
  const kinds = TASK_KINDS[taskType]
  if (!kinds) throw new ElysiumError('TASK_TYPE_INVALID', `未知任务类型：${taskType}`, 400)
  return kinds
}

export function receiptPathFor(artifactPath) {
  return `${artifactPath}.receipt.json`
}

async function sha256File(file) {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(file)) digest.update(chunk)
  return digest.digest('hex')
}

/** 采集指标并按契约判定，不落盘、不抛错。 */
export async function inspectMedia(config, file, kinds, request = null) {
  return evaluateMedia(await probeMedia(config, file, kinds), kinds, request)
}

/**
 * 判定产物并写 receipt，未通过则抛 QC_GATE_FAILED。
 *
 * 失败也要落 receipt：失败判据是下一次重试调整参数的依据。
 * 时长规则不在这里驱动——契约的 video.duration 需要请求侧期望值，成片时长由
 * validateAudioFinal 单独校验，避免两套口径冲突。
 */
export async function gateArtifact(config, file, kinds, context = {}) {
  const technical = await inspectMedia(config, file, kinds, context.request || null)
  const info = await stat(file).catch(() => null)
  const receipt = {
    receiptVersion: '1.0.0',
    contractVersion: CONTRACT.contractVersion,
    taskId: context.taskId ?? null,
    jobId: context.jobId ?? null,
    capability: context.capability ?? null,
    producedBy: 'plugin-local',
    inputHash: context.inputHash ?? null,
    outputPath: file,
    outputHash: info?.isFile() ? await sha256File(file) : null,
    sizeBytes: info?.isFile() ? info.size : 0,
    model: context.model ?? null,
    parameters: context.parameters || {},
    attempt: context.attempt || 1,
    createdAt: new Date().toISOString(),
    qc: { technical, semantic: null, score: null },
  }
  await writeJsonAtomic(receiptPathFor(file), receipt)
  if (!technical.pass) {
    throw new ElysiumError('QC_GATE_FAILED', `产物未通过健康闸门：${mediaFailureSummary(technical)}`, 422)
  }
  return receipt
}
