// 职责：管理项目配置、AI 请求与回写、人工审核版本及视频交付。
import { createProductionWorkflow } from './production.js'
import { episodeCountValue, newEpisode, ensureEpisodes, episodeView, episodeStage } from '../../database/schemas/episodes.js'
import { randomUUID } from 'node:crypto'
import { briefValue, configurationValue, modeValue, plotValue, actsValue, titleValue } from '../../database/schemas/projects.js'
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

function createEpisodeWorkflow(store, dependencies = {}) {
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
      return { role: '', subtitle: '', mode: 'independent', notes: '', ...shot, id: project.episode_id ? `${project.episode_id}-${(shot.id || `shot-${index + 1}`).replace(/^episode-[0-9]+-/, '')}` : shot.id || `shot-${index + 1}`, job_id: null, status: 'pending' }
    })
    return actsValue([{ title: '剧情分镜', shots }])
  }

  async function request(body) {
    return store.transact(body.id, project => {
      revision(project, body.revision)
      if (!['plot', 'storyboard'].includes(body.stage)) fail('生成阶段无效')
      if (body.stage === 'storyboard' && !project.workflow.plot) fail('请先生成剧情')
      if (body.stage === 'storyboard' && project.workflow.plot_stale) fail('素材已变化，请重新生成或人工确认剧情')
      if (!body.session_id || typeof body.session_id !== 'string') fail('请先打开一个 Harness 会话')
      if (project.chat_session_id && project.chat_session_id !== body.session_id) fail('请切换到该项目的关联会话')
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
    return { project_id: id, episode_id: project.episode_id || null, episode_title: project.title, episodes: (project.episodes || []).map(item => ({ id: item.id, title: item.title, plot: item.workflow.plot || '' })), request, brief: project.brief || '', mode: project.mode, plot: project.workflow.plot || '',
      material_rules: 'characters/props/scene/reference_id 只能引用 selections 中的素材 ID。未选择素材时 characters=[]、props=[]、scene=空字符串、reference_id=空字符串；人物、场景和道具的自然语言描述写进 action/prompt，不要编造素材 ID。',
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
        if (body.title !== undefined) project.title = titleValue(body.title)
        invalidate(project); project.workflow.stage = 'plot'
        project.workflow.plot_stale = false
        return []
      }
      project.acts = normalizeShots(body.shots, project)
      project.workflow.request = null; project.workflow.approval = null; project.workflow.job_id = null
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
        if (body.title !== undefined) project.title = titleValue(body.title)
        if (plot !== project.workflow.plot || project.workflow.plot_stale) { invalidate(project); project.workflow.plot = plot; project.workflow.stage = 'plot' }
        project.workflow.plot_stale = false; return []
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

  async function prepare(body) {
    const project = await store.read(body.id)
    revision(project, body.revision)
    if (project.workflow.storyboard_revision !== body.revision || project.workflow.request) fail('请先生成并审核当前版本的分镜')
    if (!project.acts.some(act => act.shots.length)) fail('分镜为空，无法提交视频')
    let plan = compile(project)
    const backend = await resolveBackend(), token = randomUUID()
    if (backend.service !== 'comfyui') {
      if (plan.shots.length !== 1) fail('当前视频模型不支持逐镜生成合片，请在设置中选择支持多镜头的模型后提交')
      const shot = plan.shots[0]
      plan = { mode: shot.image_path ? 'i2va' : 't2va', profile: 'regular', prompt: shot.prompt, duration_seconds: shot.duration, ...(shot.image_path ? { first_frame: shot.image_path } : {}) }
    }
    try { await validatePlan(backend, plan) } catch (error) { fail(`当前模型无法执行这份分镜：${error.message}。请修改分镜或在设置中选择支持的模型。`) }
    return { revision: body.revision, token, plan, backend, approved_at: Date.now() }
  }
  async function submit(body) {
    let project = await store.read(body.id)
    revision(project, body.revision)
    if (project.workflow.job_id && project.workflow.approval?.revision === body.revision) return refresh(body.id)
    const approval = body.prepared || await prepare(body)
    project = await store.transact(body.id, value => {
      revision(value, body.revision)
      value.workflow.approval = approval
      value.workflow.stage = 'submitting'; return []
    })
    try {
      const result = await start({ project_id: project.id, ...(project.episode_id ? { episode_id: project.episode_id } : {}), ...approval.plan }, undefined, approval.token)
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
  const actions = { request, edit, submit, retry, cancel }
  return { resolveConfiguration, normalizeShots, prepare, context, complete: (body, sessionId) => serialize(() => complete(body, sessionId)), refresh,
    action: (name, body) => serialize(() => { if (!actions[name]) fail('项目阶段操作无效'); return actions[name](body) }) }
}

// 剧集作用域把单集工作流读写映射回项目，聚合数组只替换所属剧集。
export function createProjectWorkflow(store, dependencies = {}) {
  const production = createProductionWorkflow(store, dependencies)
  let queue = Promise.resolve()
  const serial = fn => { const next = queue.then(fn); queue = next.catch(() => {}); return next }
  const root = createEpisodeWorkflow(store, dependencies)
  const get = async id => ensureEpisodes(await store.read(id))
  const scoped = episodeId => createEpisodeWorkflow({
    read: async id => episodeView(await get(id), episodeId),
    transact: async (id, mutate) => {
      const result = await store.transact(id, async project => {
        const view = episodeView(project, episodeId), previousRevision = view.workflow.revision, sections = await mutate(view)
        const episode = project.episodes.find(item => item.id === episodeId)
        episode.workflow = view.workflow; episode.title = view.title
        project.session_id = view.session_id
        project.acts = [...project.acts.filter(act => act.episode_id !== episodeId), ...view.acts.map(act => ({ ...act, episode_id: episodeId }))]
          .sort((a, b) => project.episodes.findIndex(e => e.id === a.episode_id) - project.episodes.findIndex(e => e.id === b.episode_id))
        project.deliverables = [...project.deliverables.filter(item => item.episode_id !== episodeId), ...view.deliverables.map(item => ({ ...item, episode_id: episodeId }))]
        if (project.episodes.length === 1) project.workflow = episode.workflow
        else { project.workflow.stage = episodeStage(project); if (view.workflow.revision !== previousRevision || sections.includes('acts') && view.workflow.stage === 'storyboard') project.workflow.revision++ }
        return sections
      })
      return episodeView(result, episodeId)
    },
  }, dependencies)
  const choose = (project, id) => {
    if (id) { episodeView(project, id); return id }
    if (project.episodes?.length !== 1) fail('请选择要操作的剧集')
    return project.episodes[0].id
  }
  const running = w => Boolean(w.request) || ['video', 'submitting'].includes(w.stage)
  const noRunning = project => { if (project.episodes.some(item => running(item.workflow))) fail('有剧集正在生成，请等待完成或取消 AI 请求后修改全剧配置') }
  async function configure(body) {
    const resolved = await root.resolveConfiguration(body.configuration)
    return store.transact(body.id, project => {
      revision(project, body.revision); noRunning(project)
      const count = episodeCountValue(body.episode_count ?? project.episode_count)
      if (count < project.episodes.length && project.episodes.slice(count).some(item => item.workflow.plot || project.acts.some(act => act.episode_id === item.id) || project.deliverables.some(film => film.episode_id === item.id))) fail('减少集数会移除已有内容，请保留这些剧集')
      project.mode = modeValue(body.mode)
      project.configuration = resolved.configuration; project.selected_materials = resolved.selections
      project.director = resolved.configuration.director; project.director_snapshot = resolved.director
      project.brief = briefValue(body.brief ?? project.brief ?? project.title)
      project.materials = [...new Set([...project.materials, ...resolved.selections.map(item => item.job_id).filter(Boolean)])]
      const previous = project.episodes
      project.episodes = Array.from({ length: count }, (_, i) => previous[i] || newEpisode(i + 1))
      project.episode_count = count
      project.workflow = count === 1 ? project.episodes[0].workflow : { revision: project.workflow.revision, stage: 'configuration', plot: '', request: null }
      for (const w of new Set([project.workflow, ...project.episodes.map(episode => episode.workflow)])) {
        invalidate({ workflow: w }); w.plot_stale = Boolean(w.plot); w.stage = 'configuration'
      }
      project.reviewed_at = null
      return ['materials']
    })
  }
  async function requestSeries(body) {
    return store.transact(body.id, project => {
      revision(project, body.revision); noRunning(project)
      if (project.workflow.request) fail('全剧正在生成')
      if (!['plot', 'storyboard'].includes(body.stage)) fail('生成阶段无效')
      if (body.stage === 'storyboard' && project.episodes.some(e => !e.workflow.plot || e.workflow.plot_stale)) fail('请先完成并确认所有分集剧情')
      if (!body.session_id || typeof body.session_id !== 'string') fail('请先打开一个 Harness 会话')
      if (project.chat_session_id && project.chat_session_id !== body.session_id) fail('请切换到该项目的关联会话')
      project.session_id = body.session_id
      project.workflow.request = { id: randomUUID(), stage: body.stage, revision: project.workflow.revision, session_id: body.session_id, episode_ids: project.episodes.map(item => item.id) }
      project.workflow.stage = `${body.stage}-generating`; project.workflow.error = null; project.reviewed_at = null
      return []
    })
  }
  function locate(project, requestId) {
    if (project.workflow.request?.id === requestId && project.workflow.request.episode_ids) return null
    const episode = project.episodes?.find(item => item.workflow.request?.id === requestId)
    if (!episode) fail('生成请求已过期或不属于当前会话')
    return episode.id
  }
  async function context(id, requestId, sessionId, offset = 0) {
    const project = await get(id), episodeId = locate(project, requestId)
    if (episodeId) return scoped(episodeId).context(id, requestId, sessionId, offset)
    const context = await root.context(id, requestId, sessionId, offset)
    return { ...context, episode_count: project.episode_count, episodes: project.episodes.map(item => ({ id: item.id, title: item.title, plot: item.workflow.plot })), instruction: context.request.stage === 'plot' ? '按 episode_ids 顺序返回全部剧集的 id/title/plot，每集剧情不超过 200 字，前后情节连贯。' : '按 episode_ids 顺序返回全部剧集的 id/shots，不能遗漏任何一集；各集分镜严格基于对应剧情。' }
  }
  async function complete(body, sessionId) {
    const project = await get(body.id), episodeId = locate(project, body.request_id)
    if (body.episode_id && body.episode_id !== episodeId) fail('回写剧集与生成请求不符')
    if (episodeId) {
      // 单集规划兼容原 plot 字段和统一 episodes 输出。
      let value = body, generatedTitle
      if (project.episodes.find(item => item.id === episodeId).workflow.request.stage === 'plot' && body.episodes) {
        if (body.episodes.length !== 1 || body.episodes[0].id !== episodeId) fail('分集剧情数量或 ID 不符')
        generatedTitle = titleValue(body.episodes[0].title)
        value = { ...body, plot: body.episodes[0].plot, title: generatedTitle }
      }
      await scoped(episodeId).complete(value, sessionId)
      return get(body.id)
    }
    return store.transact(body.id, value => {
      const request = value.workflow.request
      if (!request || request.id !== body.request_id || request.session_id !== sessionId || request.revision !== value.workflow.revision) fail('生成请求已过期或不属于当前会话')
      if (!Array.isArray(body.episodes) || body.episodes.length !== value.episodes.length || body.episodes.some((item, i) => item.id !== value.episodes[i].id)) fail('请按计划集数和剧集 ID 提交全部分集内容')
      if (request.stage === 'storyboard') {
        const acts = body.episodes.flatMap(item => root.normalizeShots(item.shots, episodeView(value, item.id)).map(act => ({ ...act, episode_id: item.id })))
        value.acts = acts
        for (const episode of value.episodes) {
          invalidate({ workflow: episode.workflow })
          episode.workflow.storyboard_revision = episode.workflow.revision; episode.workflow.stage = 'storyboard'
        }
        value.workflow.revision++; value.workflow.request = null; value.workflow.stage = 'storyboard'
        return ['acts']
      }
      const results = body.episodes.map(item => ({ title: titleValue(item.title), plot: plotValue(item.plot) }))
      value.episodes.forEach((episode, i) => {
        episode.title = results[i].title; invalidate({ workflow: episode.workflow })
        Object.assign(episode.workflow, { plot: results[i].plot, plot_stale: false, stage: 'plot' })
      })
      value.workflow.revision++; value.workflow.request = null; value.workflow.stage = 'plot'
      return []
    })
  }
  async function refresh(id) {
    let project = await get(id)
    if (!project.workflow) return project
    for (const episode of project.episodes) if (episode.workflow.job_id) await scoped(episode.id).refresh(id)
    return get(id)
  }
  async function action(name, body) {
    if (name === 'bind-session') {
      if (!body.session_id || typeof body.session_id !== 'string') fail('会话 ID 无效')
      if ((await store.list()).some(p => p.id !== body.id && p.chat_session_id === body.session_id)) fail('该会话已关联其他项目')
      return store.transact(body.id, p => { p.chat_session_id = body.session_id; return [] })
    }
    if (name === 'configure') return configure(body)
    const project = await get(body.id)
    if (!project.workflow) fail('历史项目请先保存项目素材配置')
    if (name === 'request' && !body.episode_id && project.episodes.length > 1) return requestSeries(body)
    if (project.workflow.request?.episode_ids) {
      if (name !== 'cancel' || body.episode_id) fail('全剧正在生成，请先等待或取消')
      return store.transact(body.id, p => { revision(p, body.revision); p.workflow.request = null; p.workflow.stage = episodeStage(p); return [] })
    }
    if (name === 'submit-series') {
      revision(project, body.revision)
      if (project.episodes.some(e => e.workflow.request || e.workflow.plot_stale || e.workflow.storyboard_revision !== e.workflow.revision || !project.acts.some(a => a.episode_id === e.id && a.shots.length))) fail('请先完成所有分集的当前版本分镜')
      const plans = new Map()
      for (const e of project.episodes) if (!e.workflow.job_id) plans.set(e.id, await scoped(e.id).prepare({ id: body.id, revision: e.workflow.revision }))
      const failures = []
      for (const e of project.episodes) {
        try { await scoped(e.id).action(e.workflow.stage === 'failed' && e.workflow.job_id ? 'retry' : 'submit', { id: body.id, revision: e.workflow.revision, prepared: plans.get(e.id) }) }
        catch (error) { failures.push(`${e.title}：${error.message}`) }
      }
      return store.transact(body.id, p => { p.workflow.error = failures.join('\n') || null; p.reviewed_at = null; return [] })
    }
    if (name === 'finish') {
      revision(project, body.revision)
      const latest = await refresh(body.id)
      if (latest.episodes.some(e => e.workflow.stage !== 'complete' || e.workflow.storyboard_revision !== e.workflow.revision || !latest.deliverables.some(f => f.episode_id === e.id && f.job_id === e.workflow.job_id))) fail('所有分集成片完成后才能确认项目完成')
      return store.transact(body.id, p => { p.reviewed_at = Date.now(); return [] })
    }
    const id = choose(project, body.episode_id), view = episodeView(project, id)
    if (['edit', 'request'].includes(name) && running(view.workflow)) fail('本集正在生成，请等待完成或取消当前请求')
    await scoped(id).action(name, { ...body, prepared: undefined })
    if (['edit', 'request'].includes(name)) await store.transact(body.id, p => { p.reviewed_at = null; return [] })
    return get(body.id)
  }
  return { production, context, complete: (body, sessionId) => serial(() => complete(body, sessionId)), refresh: async id => {
    const p = await store.read(id)
    if (p.production && (p.production.revision || p.production.queue || p.production.exports.length)) return production.refresh(id)
    if (!p.episodes?.length) return p
    return serial(() => refresh(id))
  }, action: (name, body) => name.startsWith('production-') ? production.action(name.slice(11), body) : serial(() => action(name, body)) }
}
