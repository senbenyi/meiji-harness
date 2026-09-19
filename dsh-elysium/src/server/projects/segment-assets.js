// 职责：把参考图生成作为项目共享素材任务，复用任务身份并同步实际服务器引用。
import { randomBytes } from 'node:crypto'
import { createJob } from '../jobs/create.js'
import { getJob } from '../jobs/query.js'
import { launch } from '../workflows/videos/launcher.js'
import { resolveGenerationBackend, validateBackendPlan } from '../../models/managers/runtime/index.js'
import { fail, text } from '../../database/schemas/production.js'
export function createSegmentAssets(store) {
  async function generate(body) {
    if (!text(body.prompt)) fail('请描述需要生成的参考图')
    const backend = await resolveGenerationBackend('image'), plan = { prompt: text(body.prompt), preset: 'standard' }, jobId = randomBytes(16).toString('hex')
    await validateBackendPlan(backend, plan)
    await store.transact(body.id, p => {
      if (p.production.revision !== body.revision || p.production.request) fail('资料已改变，请刷新')
      p.production.assets.push({ id: `asset-${jobId}`, title: body.title || text(body.prompt).slice(0, 30), description: text(body.prompt), category: 'image', job_id: jobId, url: '', status: 'pending', plan, backend, version: 1 })
      p.production.revision++; return []
    })
    return refresh(body.id)
  }
  async function refresh(id) {
    const project = await store.read(id)
    for (const asset of project.production?.assets || []) {
      if (!['pending', 'running'].includes(asset.status)) continue
      try {
        if (asset.status === 'pending') {
          await createJob(id, asset.plan, asset.backend, asset.job_id)
          const existing = await getJob(asset.job_id).catch(error => { if (error.code === 'MODEL_JOB_NOT_FOUND') return null; throw error })
          if (existing?.status !== 'succeeded') await launch(asset.job_id, 'workflow-image')
          await store.transact(id, p => { p.production.assets.find(a => a.id === asset.id).status = 'running'; return [] })
        } else {
          const job = await getJob(asset.job_id)
          if (['succeeded', 'failed'].includes(job.status)) await store.transact(id, p => {
            const a = p.production.assets.find(a => a.id === asset.id)
            a.status = job.status; a.url = job.result?.comfyui_view_url || job.result?.image_url || ''; a.error = job.error || null; return []
          })
        }
      } catch (error) { await store.transact(id, p => { const a = p.production.assets.find(a => a.id === asset.id); a.status = 'failed'; a.error = error.message; return [] }) }
    }
    return store.read(id)
  }
  async function resume(body) {
    const p = await store.read(body.id), a = p.production.assets.find(a => a.id === body.asset_id)
    if (p.production.revision !== body.revision || !a?.job_id || a.status !== 'failed') fail('请选择失败的素材任务')
    await launch(a.job_id, 'workflow-image', true)
    return store.transact(body.id, p => { const asset = p.production.assets.find(a => a.id === body.asset_id); asset.status = 'running'; asset.error = null; return [] })
  }
  return { generate, refresh, resume }
}
