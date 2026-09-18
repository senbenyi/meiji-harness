// 职责：管理项目配置、AI 请求与回写、人工审核版本及视频交付。
import { randomUUID } from 'node:crypto'
import { briefValue, configurationValue, modeValue, plotValue, actsValue } from '../../database/schemas/projects.js'
import { listAssets } from '../media/catalog.js'
import { createDirectorStore } from '../directors/service.js'
import { startVideoJob, resumeVideoJob } from '../workflows/videos/service.js'
import { getJob } from '../jobs/query.js'
import { statusError } from '../../utils/errors.js'
import { resolveGenerationBackend, validateBackendPlan } from '../../models/managers/runtime/index.js'

const fail = message => { throw statusError(409, message) }
const selectedIds = c => [c.male, c.female, ...c.supporting, ...c.props, c.scene, ...(Array.isArray(c.theme) ? c.theme : c.theme ? [c.theme] : [])].filter(Boolean)
const revision = (project, expected) => {
  if (!project.workflow) fail('历史项目请先保存项目素材配置')
  if (project.workflow.revision !== expected) fail('项目已变化，请刷新后重试')
}
const invalidate = project => {
  project.workflow.revision++
  project.workflow.request = null
  project.workflow.approval = null
  project.workflow.storyboard_revision = null
  project.workflow.job_id = null
  project.workflow.error = null
}

export function createProjectWorkflow(store, dependencies = {}) {
  const assets = dependencies.assets || (() => listAssets(0, Number.MAX_SAFE_INTEGER))
  const directors = dependencies.directors || (() => createDirectorStore().list())
  const start = dependencies.start || startVideoJob, resume = dependencies.resume || resumeVideoJob, job = dependencies.job || getJob
  const resolveBackend = dependencies.resolveBackend || (() => resolveGenerationBackend('video'))
  const validatePlan = dependencies.validatePlan || validateBackendPlan
  let operations = Promise.resolve()
  const serialize = action => { const result = operations.then(action); operations = result.catch(() => {}); return result }

  async function resolveConfiguration(config) {
    const c = configurationValue(config), { items } = await assets(), selections = []
    for (const [field, category] of [['male', 'character'], ['female', 'character'], ['supporting', 'character'], ['props', 'prop'], ['scene', 'scene'], ['theme', 'theme']]) {
      for (const id of Array.isArray(c[field]) ? c[field] : c[field] ? [c[field]] : []) {
        const item = items.find(item => item.id === id && item.category === category)
        if (!item) fail(`${field} 素材已失效或分类不符，请重新选择`)
        selections.push({ field, id, title: item.title, description: item.description || '', prompt: item.prompt || '', job_id: item.job_id || null, image_url: item.has_image ? item.comfyui_view_url || '' : '' })
      }
    }
    const director = c.director ? (await directors()).find(item => item.name === c.director) : null
    if (c.director && !director) fail('导演已失效，请重新选择')
    return { configuration: c, selections, director }
  }

  function normalizeShots(input, project) {
    if (!Array.isArray(input) || !input.length || input.length > 100) fail('请提供 1～100 个分镜')
    const allowed = new Set(selectedIds(project.configuration))
    const shots = input.map((shot, index) => {
      if (!shot.prompt?.trim() || !shot.action?.trim() || !Number.isInteger(shot.duration)) fail('每个分镜需有动作、生成提示词和整数秒时长')
      if (shot.mode !== undefined && !['independent', 'continue'].includes(shot.mode)) fail('镜头方式须为 independent 或 continue')
      if (shot.mode === 'continue' && (!index || shot.reference_id)) fail('续接镜头必须跟在前一镜后，且不另外绑定参考图')
      for (const id of [...(shot.characters || []), ...(shot.props || []), shot.scene, shot.reference_id].filter(Boolean)) if (!allowed.has(id)) fail('分镜引用了未选择的素材')
      for (const [key, fields] of [['characters', ['male', 'female', 'supporting']], ['props', ['props']], ['scene', ['scene']]]) {
        for (const id of Array.isArray(shot[key]) ? shot[key] : shot[key] ? [shot[key]] : []) if (!project.selected_materials.some(item => item.id === id && fields.includes(item.field))) fail('分镜素材分类不符')
      }
      return { role: '', subtitle: '', mode: 'independent', notes: '', ...shot, id: shot.id || `shot-${index + 1}`, job_id: null, status: 'pending' }
    })
    return actsValue([{ title: '剧情分镜', shots }])
  }

  async function configure(body) {
    const resolved = await resolveConfiguration(body.configuration)
    return store.transact(body.id, project => {
      if (!project.workflow) project.workflow = { revision: 0, plot: '', stage: 'configuration' }
      revision(project, body.revision)
      project.mode = modeValue(body.mode)
      project.configuration = resolved.configuration
      project.selected_materials = resolved.selections
      project.director = resolved.configuration.director
      project.director_snapshot = resolved.director
      project.brief = briefValue(body.brief ?? project.brief ?? project.title)
      project.materials = [...new Set([...project.materials, ...resolved.selections.map(item => item.job_id).filter(Boolean)])]
      invalidate(project); project.workflow.stage = 'configuration'
      project.workflow.plot_stale = Boolean(project.workflow.plot)
      return ['materials']
    })
  }

  async function request(body) {
    return store.transact(body.id, project => {
      revision(project, body.revision)
      if (!['plot', 'storyboard'].includes(body.stage)) fail('生成阶段无效')
      if (body.stage === 'storyboard' && !project.workflow.plot) fail('请先生成剧情')
      if (body.stage === 'storyboard' && project.workflow.plot_stale) fail('素材已变化，请重新生成或人工确认剧情')
      if (!body.session_id || typeof body.session_id !== 'string') fail('请先打开一个 Harness 会话')
      // 长小说保留全文，通过分页工具读取，不把全文挤入一次模型请求。
      project.session_id = body.session_id
      project.workflow.request = { id: randomUUID(), stage: body.stage, revision: project.workflow.revision, session_id: body.session_id }
      project.workflow.stage = `${body.stage}-generating`
      project.workflow.error = null
      return []
    })
  }

  async function context(id, requestId, sessionId, offset = 0) {
    const project = await store.read(id), request = project.workflow?.request
    if (!request || request.id !== requestId || request.session_id !== sessionId || request.revision !== project.workflow.revision) fail('生成请求已过期或不属于当前会话')
    if (!Number.isSafeInteger(offset) || offset < 0) fail('文本偏移无效')
    const reference = project.configuration.reference_text || ''
    return { project_id: id, request, brief: project.brief, mode: project.mode, plot: project.workflow.plot,
      selections: project.selected_materials || [], director: project.director_snapshot || null,
      reference_text: reference.slice(offset, offset + 12000), reference_offset: offset, reference_total: reference.length,
      next_offset: offset + 12000 < reference.length ? offset + 12000 : null }
  }

  async function complete(body, sessionId) {
    return store.transact(body.id, project => {
      const request = project.workflow?.request
      if (!request || request.id !== body.request_id || request.session_id !== sessionId || request.revision !== project.workflow.revision) fail('生成请求已过期或不属于当前会话')
      if (request.stage === 'plot') {
        project.workflow.plot = plotValue(body.plot)
        invalidate(project); project.workflow.stage = 'plot'
        project.workflow.plot_stale = false
        return []
      }
      project.acts = normalizeShots(body.shots, project)
      project.workflow.request = null; project.workflow.approval = null
      project.workflow.storyboard_revision = project.workflow.revision
      project.workflow.stage = 'storyboard'
      return ['acts']
    })
  }

  async function edit(body) {
    return store.transact(body.id, project => {
      revision(project, body.revision)
      if (body.plot !== undefined) {
        const plot = plotValue(body.plot)
        if (plot !== project.workflow.plot) { invalidate(project); project.workflow.plot = plot }
        project.workflow.plot_stale = false; project.workflow.stage = 'plot'; return []
      }
      if (project.workflow.storyboard_revision !== project.workflow.revision) fail('上游已变化，请重新生成分镜')
      project.acts = normalizeShots(body.shots, project)
      invalidate(project); project.workflow.storyboard_revision = project.workflow.revision
      project.workflow.stage = 'storyboard'; return ['acts']
    })
  }

  function compile(project) {
    const shots = project.acts.flatMap(act => act.shots).map(shot => {
      const reference = shot.reference_id ? project.selected_materials.find(item => item.id === shot.reference_id) : null
      if (shot.reference_id && !reference?.image_url) fail(`镜头 ${shot.id} 缺少可用的服务器参考图，请修改分镜`)
      const descriptions = (project.selected_materials || []).filter(item => [...(shot.characters || []), ...(shot.props || []), shot.scene].includes(item.id)).map(item => `${item.title}: ${item.description}`)
      return { id: shot.id, duration: shot.duration, mode: shot.mode === 'continue' ? 'continue' : 'independent',
        prompt: [shot.prompt, `动作：${shot.action}`, shot.framing, shot.camera, shot.lighting, shot.sound, shot.subtitle, ...descriptions, project.director_snapshot?.style].filter(Boolean).join('\n'),
        ...(reference ? { image_path: reference.image_url } : {}) }
    })
    return { duration: shots.reduce((sum, shot) => sum + shot.duration, 0), shots }
  }

  async function submit(body) {
    let project = await store.read(body.id)
    revision(project, body.revision)
    if (project.workflow.job_id && project.workflow.approval?.revision === body.revision) return refresh(body.id)
    if (project.workflow.storyboard_revision !== body.revision || project.workflow.request) fail('请先生成并审核当前版本的分镜')
    let plan = compile(project)
    const backend = await resolveBackend(), token = randomUUID()
    if (backend.service !== 'comfyui') {
      if (plan.shots.length !== 1) fail('当前视频模型不支持逐镜生成合片，请在设置中选择支持多镜头的模型后提交')
      const shot = plan.shots[0]
      plan = { mode: shot.image_path ? 'i2va' : 't2va', profile: 'regular', prompt: shot.prompt, duration_seconds: shot.duration, ...(shot.image_path ? { first_frame: shot.image_path } : {}) }
    }
    try { await validatePlan(backend, plan) } catch (error) { fail(`当前模型无法执行这份分镜：${error.message}。请修改分镜或在设置中选择支持的模型。`) }
    project = await store.transact(body.id, value => {
      revision(value, body.revision)
      value.workflow.approval = { revision: body.revision, token, plan, backend, approved_at: Date.now() }
      value.workflow.stage = 'submitting'; return []
    })
    try {
      const result = await start({ project_id: project.id, ...plan }, undefined, token)
      return store.transact(body.id, value => {
        value.workflow.job_id = result.job_id; value.workflow.stage = 'video'; value.workflow.error = null
        for (const act of value.acts) for (const shot of act.shots) { shot.job_id = result.job_id; shot.status = result.status }
        return ['acts']
      })
    } catch (error) {
      await store.transact(body.id, value => {
        value.workflow.stage = error.job_id ? 'failed' : 'storyboard'; value.workflow.error = error.message
        if (error.job_id) value.workflow.job_id = error.job_id
        return []
      })
      throw error
    }
  }

  async function refresh(id) {
    const project = await store.read(id)
    if (!project.workflow?.job_id) return project
    const current = await job(project.workflow.job_id)
    const stage = current.status === 'succeeded' ? 'complete' : current.status === 'failed' ? 'failed' : 'video'
    if (project.workflow.stage === stage && project.workflow.job_status === current.status) return project
    return store.transact(id, value => {
      if (value.workflow.job_id !== current.job_id) return []
      value.workflow.stage = stage; value.workflow.job_status = current.status; value.workflow.error = current.error || null
      for (const act of value.acts) for (const shot of act.shots) { shot.status = current.status; shot.job_id = current.job_id }
      if (stage === 'complete' && !value.deliverables.some(item => item.job_id === current.job_id)) value.deliverables.push({ type: 'video', label: value.title, job_id: current.job_id })
      return ['acts', 'deliverables']
    })
  }
  async function retry(body) {
    const project = await store.read(body.id)
    revision(project, body.revision)
    if (!project.workflow.job_id || project.workflow.approval?.revision !== body.revision) fail('当前版本没有可恢复任务')
    await resume(project.workflow.job_id)
    return refresh(body.id)
  }
  async function cancel(body) {
    return store.transact(body.id, project => {
      revision(project, body.revision)
      project.workflow.request = null
      project.workflow.stage = project.workflow.plot ? 'plot' : 'configuration'
      return []
    })
  }
  const actions = { configure, request, edit, submit, retry, cancel }
  return { context, complete: (body, sessionId) => serialize(() => complete(body, sessionId)), refresh,
    action: (name, body) => serialize(() => { if (!actions[name]) fail('项目阶段操作无效'); return actions[name](body) }) }
}
