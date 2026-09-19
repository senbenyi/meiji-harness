// 职责：校验请求、保留付费提交记录、轮询原任务并持久化媒体。
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { bytePlusKey } from './config.js'
import { createClient } from './index.js'
import { readJson, saveJson } from '../../../../database/json.js'
import { MODE_MEDIA, VIDEO_MODES, VIDEO_PROFILES } from '../../contract.js'
const invalid = message => { throw Object.assign(new Error(message), { status: 422, code: 'MODEL_INPUT_INVALID' }) }
const reference = value => typeof value === 'string' && (/^job:[a-f0-9]{32}$/.test(value) || /^asset:\/\/[^\s]+$/.test(value) || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) || (() => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password } catch { return false } })())
export function validatePlan(plan, backend) {
  if (!plan || typeof plan.prompt !== 'string' || !plan.prompt.trim()) invalid('请填写非空提示词')
  if (!VIDEO_MODES.includes(plan.mode) || plan.quality !== undefined && !['fast', 'regular', 'high'].includes(plan.quality)
    || plan.profile !== undefined && !VIDEO_PROFILES.includes(plan.profile)) invalid('视频模式或创作质量无效')
  const required = MODE_MEDIA[plan.mode]
  if (Object.keys(plan).some(key => !['prompt', 'mode', 'profile', 'quality', 'resolution', 'duration_seconds', ...required].includes(key))) invalid('三方视频包含未支持参数')
  for (const key of required) if (!reference(plan[key])) invalid(`${key} 必须是图片素材 ID 或供应商可访问的图片引用`)
  const seconds = plan.duration_seconds ?? backend.connection.duration
  if (!Number.isInteger(seconds) || seconds < 4 || seconds > 15) invalid('Seedance 2.0 时长必须为4至15的整数秒')
  if (!['480p', '720p', '1080p'].includes(plan.resolution ?? backend.connection.resolution)) invalid('视频创作质量没有有效分辨率')
  if (!['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'].includes(backend.connection.ratio) || typeof backend.connection.generate_audio !== 'boolean') invalid('请配置视频 ratio 和 generate_audio')
}
async function payload(plan, backend, ctx) {
  const roles = { first_frame: 'first_frame', last_frame: 'last_frame', reference_image_1: 'reference_image', reference_image_2: 'reference_image' }
  return { model: backend.connection.model, content: [{ type: 'text', text: plan.prompt }, ...await Promise.all(MODE_MEDIA[plan.mode].map(async key => ({ type: 'image_url', role: roles[key], image_url: { url: await ctx.imageReference(plan[key]) } })))],
    duration: plan.duration_seconds ?? backend.connection.duration, resolution: plan.resolution ?? backend.connection.resolution, ratio: backend.connection.ratio,
    generate_audio: backend.connection.generate_audio, watermark: backend.connection.watermark ?? false }
}
export async function executeJob(plan, backend, ctx) {
  validatePlan(plan, backend)
  bytePlusKey(backend)
  const { directory, signal } = ctx, sleep = ctx.pause || setTimeout, journalPath = join(directory, 'byteplus-submission.json')
  const client = createClient(backend, { signal })
  const status = await ctx.start({ capability: 'workflow-video', backend: 'byteplus', server: backend, debug: { effective_input: plan } })
  try {
    let journal = await readJson(journalPath)
    if (!journal) {
      const request = await payload(plan, backend, ctx)
      // 提交开始即落盘；未知 POST 结果禁止自动重发，避免重复计费。
      journal = { state: 'submitting', request_hash: createHash('sha256').update(JSON.stringify(request)).digest('hex') }
      await saveJson(journalPath, journal)
      status.stage = 'submit'; await ctx.save(status)
      const response = await client.request('contents/generations/tasks', request)
      journal = { ...journal, state: 'submitted', response }
      await saveJson(journalPath, journal)
    }
    if (journal.state === 'submitting') throw Object.assign(new Error('供应商提交结果未知；禁止重发。请核对供应商任务并将原响应补入 byteplus-submission.json 后恢复'), { code: 'BYTEPLUS_SUBMISSION_UNKNOWN' })
    let result = journal.response
    if (!result.id) throw new Error('供应商未返回任务 ID，禁止重发')
    status.remote_task_id = result.id; status.stage = 'poll'; await ctx.save(status)
    const deadline = Date.now() + 60 * 60 * 1000
    for (;;) {
      signal?.throwIfAborted()
      result = await client.request(`contents/generations/tasks/${encodeURIComponent(journal.response.id)}`)
      await saveJson(join(directory, 'byteplus-result.json'), result)
      if (result.status === 'succeeded') break
      if (['failed', 'cancelled', 'expired'].includes(result.status)) throw Object.assign(new Error(`原供应商任务${result.status}，恢复不会创建新任务`), { code: 'BYTEPLUS_TASK_FAILED' })
      if (Date.now() >= deadline) throw new Error('等待超时，请使用原任务 ID 恢复查询')
      await sleep(5000, undefined, { signal })
    }
    const url = result.content?.video_url
    if (!url || !['http:', 'https:'].includes(new URL(url).protocol)) throw new Error('供应商缺少有效产物 URL')
    status.stage = 'download'; await ctx.save(status)
    const response = await fetch(url, { signal, redirect: 'error' })
    if (!response.ok) throw new Error(`产物下载失败：HTTP ${response.status}`)
    const output = { ...await ctx.saveMedia(response.body, { extension: '.mp4', kind: 'video' }), provider: 'byteplus', model: backend.connection.model,
      quality: plan.quality, profile: plan.profile, remote_task_id: journal.response.id, duration_sec: result.duration ?? plan.duration_seconds ?? backend.connection.duration,
      specification: { resolution: plan.resolution ?? backend.connection.resolution, ratio: backend.connection.ratio, audio: backend.connection.generate_audio } }
    return await ctx.succeed(status, output)
  } catch (error) {
    await ctx.fail(status, error, { code: 'BYTEPLUS_GENERATION_FAILED', retry_scope: 'query-original-byteplus-task' })
    throw error
  }
}
