// 职责：按生产清单顺序编排镜头生成、恢复与状态持久化。
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { validateBackend, extractBackendReference, createBackendClient, resolveGenerationBackend, readBackend, sameBackend, withBackend } from '../../servers/runtime/index.js'
import { requiredConfig, runtimeConfig } from '../../utils/config.js'
import { createJob } from '../jobs/create.js'
import { projectJobRoot } from '../jobs/paths.js'
import { readJson, saveJson } from '../jobs/store.js'
import { launch } from '../video/launcher.js'
import { withLaunchLock } from '../jobs/lock.js'
import { completedResult, getJob } from '../jobs/query.js'
import { waitJob } from '../jobs/wait.js'
import { resumeVideoJob } from '../video/service.js'
import { validateVideoPlan } from '../video/plan.js'
import { resolveShotRequest } from './manifest.js'
import { finishAttempt, initializeProduction, productionDirectory, readAnchors, saveAnchors, saveProgress, shotPaths } from './state.js'

export async function executeVideoShot(projectId, request, receiptPath, signal) {
  const saved = await readJson(receiptPath)
  if (saved && JSON.stringify(saved.request) !== JSON.stringify(request)) throw new Error('回执属于不同镜头；必须使用原请求')
  const pinned = runtimeConfig().ELYSIUM_BACKEND
  const backend = saved ? await readBackend(projectJobRoot(projectId, saved.job_id)) : pinned || await resolveGenerationBackend('video')
  if (saved?.backend && !sameBackend(saved.backend, backend)) throw new Error('镜头回执服务器与任务快照不一致')
  if (pinned && !sameBackend(pinned, backend)) throw new Error('镜头回执与本轮服务器不一致')
  return withBackend(backend, async () => {
    await validateVideoPlan(request)
    const jobId = saved?.job_id || await createJob(projectId, request)
    if (!saved) await saveJson(receiptPath, { request, job_id: jobId, backend })
    let current
    try { current = await getJob(jobId) } catch (error) { if (error.code !== 'MODEL_JOB_NOT_FOUND') throw error }
    const job = !current ? await launch(jobId) : current.status === 'succeeded' ? { job_id: jobId, status: 'succeeded' } : await resumeVideoJob(jobId)
    const result = job.status === 'succeeded' ? completedResult(current) : await waitJob(job, signal)
    const receipt = { request, job_id: jobId, backend, result }
    await saveJson(receiptPath, receipt)
    return receipt
  })
}

export async function runProduction(manifest, options = {}) {
  const stateRoot = options.stateRoot || requiredConfig('ELYSIUM_STATE_ROOT')
  const directory = productionDirectory(stateRoot, manifest.project_id)
  const limit = options.limit ?? manifest.shots.length
  if (!Number.isInteger(limit) || limit < 1 || limit > manifest.shots.length) throw new Error(`limit 必须为 1..${manifest.shots.length}`)
  const execute = options.executeShot || executeVideoShot
  let createReference = options.extractReference
  const log = options.log || console.log
  await mkdir(join(directory, 'runner'), { recursive: true })
  return withLaunchLock(join(directory, 'runner'), async () => {
    let backend = await readJson(join(directory, 'input/backend.json'))
    if (!backend && await readJson(join(directory, 'manifest.json'))) throw new Error('旧批次缺少服务器快照，请核对原回执后迁移；禁止使用当前默认服务器恢复')
    backend ||= await resolveGenerationBackend('video')
    const provider = await validateBackend(backend)
    backend = { ...backend, provider_api_version: provider.apiVersion }
    createReference ||= args => extractBackendReference(backend, args)
    const client = options.client || await createBackendClient(backend, { signal: options.signal })
    if (client.url?.href !== new URL(backend.base_url.replace(/\/?$/, '/')).href) throw new Error('生产客户端与本轮服务器不一致')
    await saveJson(join(directory, 'input/backend.json'), backend)
    return withBackend(backend, async () => {
      await initializeProduction(directory, manifest)
      const anchors = await readAnchors(directory)
      let completed = 0
      for (const shot of manifest.shots.slice(0, limit)) {
        options.signal?.throwIfAborted()
        const paths = shotPaths(directory, shot.id)
        const request = await resolveShotRequest(manifest, shot, anchors)
        let receipt = await readJson(paths.receipt)
        if (receipt && (!receipt.backend || !sameBackend(receipt.backend, backend))) throw new Error('镜头回执与本轮服务器不一致')
        const attempts = await readJson(paths.attempts) || []
        while (receipt?.result?.status !== 'succeeded') {
          if (attempts.length >= manifest.max_attempts) throw new Error(`${shot.id}: 已耗尽 ${manifest.max_attempts} 次执行预算，请人工检查原回执`)
          attempts.push({ started_at: new Date().toISOString() })
          await saveJson(paths.attempts, attempts)
          log(`${shot.id}: 第 ${attempts.length} 次执行`)
          try {
            receipt = await execute(manifest.project_id, request, paths.receipt, options.signal)
            receipt = { ...receipt, backend }
            await saveJson(paths.receipt, receipt)
            await finishAttempt(paths.attempts, attempts, receipt.result?.status || 'interrupted')
          } catch (error) {
            await finishAttempt(paths.attempts, attempts, 'interrupted')
            throw error
          }
        }
        const promptId = receipt.result.comfyui_prompt_id
        if (promptId && !await readJson(paths.history)) {
          const history = (await client.request(`history/${encodeURIComponent(promptId)}`))[promptId]
          if (!history?.status?.completed) throw new Error(`${shot.id}: 缺少成功的 ComfyUI history`)
          await saveJson(paths.history, history)
        }
        if (shot.produces_anchor && !anchors[shot.produces_anchor.id]) {
          anchors[shot.produces_anchor.id] = await createReference({ client, projectId: manifest.project_id, shotId: shot.id, source: receipt.result, definition: shot.produces_anchor, paths })
          await saveAnchors(directory, anchors)
        }
        completed++
        await saveProgress(directory, { project_id: manifest.project_id, completed, target: limit, total: manifest.shots.length, checked_shot: shot.id, last_job_id: receipt.job_id, updated_at: new Date().toISOString() })
        log(`${shot.id}: 完成 ${receipt.job_id}`)
      }
      return { project_id: manifest.project_id, completed, target: limit, total: manifest.shots.length, directory }
    })
  }, true)
}
