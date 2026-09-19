// 职责：清空旧素材图片、发布三视图目录，并按条目生成图片任务。
import { mkdir, copyFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { libraryMaterials, generateSlugs } from '../resources/library-catalog.mjs'
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

const generateOnly = process.argv.includes('--generate-only')
const publishOnly = process.argv.includes('--publish-only')

await withConfig(resolveConfig(), async () => {
  const directory = join(runtimeRoot(), 'migrations', 'library-materials-v1')
  await mkdir(directory, { recursive: true })
  const statePath = join(directory, 'state.json')
  const state = await readJson(statePath) || { jobs: {} }
  await writeFile(new URL('../resources/library-materials.json', import.meta.url), JSON.stringify({ version: 1, materials: libraryMaterials }, null, 2))
  if (!state.backed_up) {
    await listAssets(0, 1)
    await copyFile(join(poolsRoot(), 'materials.json'), join(directory, 'materials.json'), 1).catch(error => { if (!['ENOENT', 'EEXIST'].includes(error.code)) throw error })
    state.backed_up = true
    await saveJson(statePath, state)
  }
  if (!generateOnly) {
    await listAssets(0, 1)
    const keep = new Set(libraryMaterials.map(item => item.id))
    for (const item of await syncMaterials([])) {
      if (item.deleted || keep.has(item.id)) continue
      if (item.job_id || ['character', 'scene', 'prop'].includes(item.category)) await removeMaterial(item.id)
    }
    state.created_at ||= Date.now()
    for (const item of libraryMaterials) {
      const jobId = generateSlugs.includes(item.slug) ? state.jobs[item.id] : undefined
      await addMaterial({
        id: item.id, set_id: item.set_id, view: item.view, category: item.category, subcategory: item.subcategory,
        title: item.title, tags: item.tags, description: item.description, prompt: item.prompt,
        source: 'creation', created_at: state.created_at - item.created_at_offset,
        ...(jobId ? { job_id: jobId, project_id: state.project_id } : {}),
      })
    }
    state.published = true
    await saveJson(statePath, state)
    console.log(`Published ${libraryMaterials.length} views across ${libraryMaterials.length / 3} sets`)
    if (publishOnly) return
  }
  const generateMaterials = libraryMaterials.filter(item => generateSlugs.includes(item.slug))
  const projectId = state.project_id || await ensureFreeProject()
  state.project_id = projectId
  await saveJson(statePath, state)
  const backend = await resolveGenerationBackend('image')
  for (const [index, item] of generateMaterials.entries()) {
    const plan = { prompt: item.prompt, seed: 20260919 + item.created_at_offset, preset: 'standard' }
    if (!state.jobs[item.id]) {
      await validateBackendPlan(backend, plan)
      state.jobs[item.id] = await createJob(projectId, plan, backend)
      await saveJson(statePath, state)
    }
    const jobId = state.jobs[item.id]
    let job = await getJob(jobId).catch(error => { if (error.code === 'MODEL_JOB_NOT_FOUND') return null; throw error })
    if (job?.status !== 'succeeded') job = await waitJob(await launch(jobId, 'workflow-image'))
    if (job.status === 'failed') throw new Error(`${item.title} ${item.view}: ${job.error}; resume with this script using the same job`)
    await addMaterial({
      id: item.id, set_id: item.set_id, view: item.view, category: item.category, subcategory: item.subcategory,
      title: item.title, tags: item.tags, description: item.description, prompt: item.prompt,
      source: 'creation', created_at: (state.created_at || Date.now()) - item.created_at_offset,
      job_id: jobId, project_id: projectId,
    })
    console.log(`Generated ${index + 1}/${generateMaterials.length} ${item.title} ${item.view} ${jobId}`)
  }
  state.generated = true
  await saveJson(statePath, state)
})
