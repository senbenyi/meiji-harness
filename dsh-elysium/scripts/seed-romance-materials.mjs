// 职责：可恢复地生成恋爱素材，备份旧索引并发布五类素材库；媒体留在生成服务器。
import { readFile, mkdir, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveConfig, withConfig } from '../src/config.js'
import { runtimeRoot, poolsRoot } from '../src/database/paths.js'
import { readJson, saveJson } from '../src/database/json.js'
import { listAssets } from '../src/server/media/catalog.js'
import { addMaterial, removeMaterial, syncMaterials } from '../src/database/managers/materials.js'
import { ensureFreeProject, createJob } from '../src/server/jobs/create.js'
import { getJob } from '../src/server/jobs/query.js'
import { launch } from '../src/server/workflows/videos/launcher.js'
import { waitJob } from '../src/server/jobs/wait.js'
import { resolveGenerationBackend, validateBackendPlan } from '../src/models/managers/runtime/index.js'

const manifest = JSON.parse(await readFile(new URL('../resources/romance-materials.json', import.meta.url), 'utf8'))
await withConfig(resolveConfig(), async () => {
  const directory = join(runtimeRoot(), 'migrations', 'romance-materials-v1')
  await mkdir(directory, { recursive: true })
  const statePath = join(directory, 'state.json')
  const state = await readJson(statePath) || { jobs: {} }
  if (!state.backed_up) {
    await listAssets(0, 1)
    for (const name of ['materials.json', 'directors.json']) {
      await copyFile(join(poolsRoot(), name), join(directory, name), 1).catch(error => { if (!['ENOENT', 'EEXIST'].includes(error.code)) throw error })
    }
    state.backed_up = true
    await saveJson(statePath, state)
  }
  const projectId = await ensureFreeProject()
  const backend = await resolveGenerationBackend('image')
  for (const [index, item] of manifest.materials.entries()) {
    if (!item.prompt) continue
    const plan = { prompt: item.prompt, seed: 20260919 + index, preset: 'standard' }
    if (!state.jobs[item.id]) {
      await validateBackendPlan(backend, plan)
      state.jobs[item.id] = await createJob(projectId, plan, backend)
      await saveJson(statePath, state)
    }
    const jobId = state.jobs[item.id]
    let job = await getJob(jobId).catch(error => { if (error.code === 'MODEL_JOB_NOT_FOUND') return null; throw error })
    if (job?.status !== 'succeeded') job = await waitJob(await launch(jobId, 'workflow-image'))
    if (job.status === 'failed') throw new Error(`${item.title}: ${job.error}; resume with this script using the same job`)
    console.log(`Generated ${index + 1}/26 ${item.title} ${jobId}`)
  }
  if (process.argv.includes('--generate-only')) return
  await listAssets(0, 1)
  const generated = new Set(Object.values(state.jobs)), ids = new Set(manifest.materials.map(item => item.id))
  for (const item of await syncMaterials([])) if (!ids.has(item.id) && !generated.has(item.job_id)) await removeMaterial(item.id)
  state.created_at ||= Date.now()
  for (const [index, item] of manifest.materials.entries()) {
    await addMaterial({ ...item, source: 'creation', created_at: state.created_at - index,
      ...(state.jobs[item.id] ? { job_id: state.jobs[item.id], project_id: projectId } : {}) })
  }
  const names = new Set(manifest.directors.map(item => item.name))
  const existing = await readJson(join(poolsRoot(), 'directors.json')) || []
  await saveJson(join(poolsRoot(), 'directors.json'), [...manifest.directors, ...existing.filter(item => !names.has(item.name)).map(item => ({ ...item, archived: true }))])
  state.published = true
  await saveJson(statePath, state)
  console.log('Published: 6 characters, 12 scenes, 8 props, 6 themes, 8 directors')
})
