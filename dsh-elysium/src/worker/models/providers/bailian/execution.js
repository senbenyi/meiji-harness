// 职责：校验万相请求、保存提交凭据、恢复原任务并下载成片。
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { bailianKey } from './config.js'
import { createClient } from './index.js'
import { readJson, saveJson } from '../../../../database/json.js'
import { VIDEO_PROFILES } from '../../contract.js'
const invalid = message => { throw Object.assign(new Error(message), { status: 422, code: 'MODEL_INPUT_INVALID' }) }
const sizes = {
  '720P': { '16:9': '1280*720', '9:16': '720*1280', '1:1': '960*960', '4:3': '1088*832', '3:4': '832*1088' },
  '1080P': { '16:9': '1920*1080', '9:16': '1080*1920', '1:1': '1440*1440', '4:3': '1632*1248', '3:4': '1248*1632' },
}
const reference = value => typeof value === 'string' && (/^job:[a-f0-9]{32}$/.test(value) || /^data:image\/(png|jpeg|webp|bmp);base64,[A-Za-z0-9+/=]+$/.test(value) || (() => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password } catch { return false } })())
export function validatePlan(plan, backend) {
  if (!plan || typeof plan.prompt !== 'string' || !plan.prompt.trim() || [...plan.prompt].length > 1500) invalid('百炼提示词必须为1至1500字')
  if (!['t2va', 'i2va'].includes(plan.mode)) invalid('万相 2.6 仅支持 t2va、i2va；其他模式不会丢弃素材后提交')
  if (plan.profile !== undefined && !VIDEO_PROFILES.includes(plan.profile)) invalid('视频档次无效')
  if (Object.keys(plan).some(key => !['prompt', 'mode', 'profile', 'quality', 'resolution', 'duration_seconds', ...(plan.mode === 'i2va' ? ['first_frame'] : [])].includes(key))) invalid('百炼视频包含未支持参数')
  if (plan.mode === 'i2va' && !reference(plan.first_frame)) invalid('first_frame 必须为 job:图片素材ID、HTTPS URL 或图片数据')
  const seconds = plan.duration_seconds ?? backend.connection.duration
  if (!Number.isInteger(seconds) || seconds < 2 || seconds > 15) invalid('万相 2.6 时长必须为2至15的整数秒')
  if (plan.quality !== undefined && !['regular', 'high'].includes(plan.quality) || !sizes[plan.resolution ?? backend.connection.resolution]?.[backend.connection.ratio]) invalid('百炼创作质量仅支持常规创作或高清创作')
  for (const key of ['prompt_extend', 'watermark']) if (typeof backend.connection[key] !== 'boolean') invalid(`百炼 ${key} 必须为布尔值`)
}
async function payload(plan, backend, ctx) {
  const config = backend.connection, image = plan.mode === 'i2va'
  return { model: image ? config.image_model : config.text_model,
    input: { prompt: plan.prompt, ...(image ? { img_url: await ctx.imageReference(plan.first_frame) } : {}) },
    parameters: { duration: plan.duration_seconds ?? config.duration, prompt_extend: config.prompt_extend, watermark: config.watermark,
      ...(image ? { resolution: plan.resolution ?? config.resolution } : { size: sizes[plan.resolution ?? config.resolution][config.ratio] }) } }
}
export async function executeJob(plan, backend, ctx) {
  validatePlan(plan, backend)
  bailianKey(backend)
  const { directory, signal } = ctx, sleep = ctx.pause || setTimeout, journalPath = join(directory, 'bailian-submission.json')
  const client = createClient(backend, { signal })
  const requestHash = createHash('sha256').update(JSON.stringify({ plan, backend })).digest('hex')
  const status = await ctx.start({ capability: 'workflow-video', backend: 'bailian', server: backend, debug: { effective_input: plan } })
  try {
    let journal = await readJson(journalPath)
    if (journal && journal.request_hash !== requestHash) throw new Error('原百炼任务参数不一致，禁止重新提交')
    if (!journal) {
      const request = await payload(plan, backend, ctx)
      journal = { state: 'submitting', request_hash: requestHash }
      await saveJson(journalPath, journal)
      status.stage = 'submit'; await ctx.save(status)
      // 先落盘再付费提交；网络断开或5xx不能证明未创建任务，禁止自动重发。
      let response
      try { response = await client.request('services/aigc/video-generation/video-synthesis', request) }
      catch (error) {
        if (error.http_status >= 400 && error.http_status < 500) {
          journal = { ...journal, state: 'rejected', http_status: error.http_status }
          await saveJson(journalPath, journal)
        }
        throw error
      }
      journal = { ...journal, state: 'submitted', response }
      await saveJson(journalPath, journal)
    }
    if (journal.state === 'submitting') throw Object.assign(new Error('百炼提交结果未知，禁止重发；请核对供应商原任务'), { code: 'BAILIAN_SUBMISSION_UNKNOWN' })
    if (journal.state === 'rejected') throw new Error(`百炼原提交被拒绝：HTTP ${journal.http_status}，恢复不会重新提交`)
    const taskId = journal.response?.output?.task_id
    if (!taskId) throw new Error('百炼未返回任务 ID，禁止重发')
    status.remote_task_id = taskId; status.stage = 'poll'; await ctx.save(status)
    const deadline = Date.now() + 60 * 60 * 1000
    let result
    for (;;) {
      signal?.throwIfAborted()
      result = await client.request(`tasks/${encodeURIComponent(taskId)}`)
      await saveJson(join(directory, 'bailian-result.json'), result)
      const state = result.output?.task_status
      if (state === 'SUCCEEDED') break
      if (!['PENDING', 'RUNNING'].includes(state)) throw Object.assign(new Error(`百炼原任务状态 ${['FAILED', 'CANCELED', 'UNKNOWN'].includes(state) ? state : '无效'}，恢复不会创建新任务`), { code: 'BAILIAN_TASK_FAILED' })
      if (Date.now() >= deadline) throw new Error('等待百炼超时，请使用原任务 ID 恢复查询')
      await sleep(5000, undefined, { signal })
    }
    const url = result.output.video_url
    if (!url || !['http:', 'https:'].includes(new URL(url).protocol)) throw new Error('百炼缺少有效产物 URL')
    status.stage = 'download'; await ctx.save(status)
    const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(300000)]) : AbortSignal.timeout(300000), redirect: 'error' })
    if (!response.ok) throw new Error(`百炼产物下载失败：HTTP ${response.status}`)
    const output = { ...await ctx.saveMedia(response.body, { extension: '.mp4', kind: 'video' }), provider: 'bailian',
      model: plan.mode === 'i2va' ? backend.connection.image_model : backend.connection.text_model, quality: plan.quality, profile: plan.profile,
      remote_task_id: taskId, duration_sec: plan.duration_seconds ?? backend.connection.duration,
      specification: { resolution: plan.resolution ?? backend.connection.resolution, ratio: plan.mode === 'i2va' ? 'source-image' : backend.connection.ratio, audio: true } }
    return await ctx.succeed(status, output)
  } catch (error) {
    await ctx.fail(status, error, { code: 'BAILIAN_GENERATION_FAILED', retry_scope: 'query-original-bailian-task' })
    throw error
  }
}
