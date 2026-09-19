// 职责：定义模型层与任务层之间的唯一契约：业务词汇、Provider 接口与 TaskContext；模型层不得 import 任务层模块。

export const VIDEO_MODES = Object.freeze(['t2va', 'i2va', 'fl2va', 'fl2va-loop', 'r2va'])
export const VIDEO_PROFILES = Object.freeze(['preview', 'regular', 'high-quality', 'standard'])
export const MODE_MEDIA = Object.freeze({
  t2va: [],
  i2va: ['first_frame'],
  fl2va: ['first_frame', 'last_frame'],
  'fl2va-loop': ['first_frame', 'last_frame'],
  r2va: ['reference_image_1', 'reference_image_2'],
})

/**
 * Provider（providers/<id>/index.js 默认导出）
 *   id, label, apiVersion, services
 *   validate(backend)                    后端快照是否属于本平台
 *   preparePlan(plan, quality, backend)  按全局创作质量补全计划
 *   validatePlan(plan, backend)          提交前校验，失败抛 MODEL_INPUT_INVALID
 *   executeJob(plan, backend, ctx)       在 worker 进程内执行一次任务，只通过 ctx 回报
 *   connect / check / probe / createClient / buildGraph / llmSettings / workflowSource / manage
 *   可选：channel()、generationBackend(kind, model)、guidance、syncWorkflows(args)
 *
 * TaskContext（由 worker/runner/context.js 创建）
 *   jobId, projectId, directory, signal
 *   start(fields) → status               写入 running，自动附带 code_version
 *   save(status)                         保存进度（stage 等）
 *   succeed(status, result) / fail(status, error, { code, retry_scope, recovery_instruction })
 *   saveMedia(stream, { extension, kind }) → { media_kind, local_media_path }
 *   imageReference(value) → 'job:<id>' 转为 data URI，其他引用原样返回
 */
