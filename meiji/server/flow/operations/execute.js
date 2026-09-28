// 操作分派流水线：按阶段依次准备上下文，再交给对应领域的处理函数。
// 阶段顺序与原 executeOperation 完全一致：
//   pre（无需项目）→ 读取项目 → project（项目级）→ 剧集作用域 → review（候选图片确认）→ 自检准备 → episode（剧集级）。
// 处理函数通过共享上下文 c 读写 operation / projects / project，错误处理看到的是最新值。
import { linkStore } from '../../data/links.js'
import { materialize, normalizeProject, scopeProjects } from '../../data/episodes.js'
import { readImageDraft } from '../../data/pictures.js'
import { revisionStore } from '../../data/projects.js'
import { checkContext, prepareChecks, setCheck } from '../../data/self-checks.js'
import { feedbackOf } from '../../../shared/feedback.js'
import { canGenerate } from '../../../shared/gates.js'
import { episodeScoped } from './registry.js'
import { services } from './services.js'
import { projectOperations } from './project.js'
import { storyOperations } from './story.js'
import { imageOperations } from './images.js'
import { filmOperations } from './films.js'

export const operations = { ...projectOperations, ...storyOperations, ...imageOperations, ...filmOperations }

export async function executeOperation(operation, deps) {
  const { home } = deps
  const { projects: storedProjects, models, library } = services(home)
  const rootProjects = revisionStore(storedProjects, deps.operationId, operation)
  const trace = []
  const c = { operation, deps, home, storedProjects, rootProjects, projects: rootProjects, models, library, project: null, submittedReview: '', trace, note: line => { trace.push(line) } }
  const handler = stage => {
    const entry = operations[c.operation.action]
    return entry?.stage === stage ? entry.run : null
  }
  if (operation.sessionId && operation.projectId) await linkStore(home).requireProject(operation.sessionId, operation.projectId)
  try {
    const pre = handler('pre')
    if (pre) return await pre(c)
    const project = c.operation.projectId ? normalizeProject(await rootProjects.read(c.operation.projectId)) : null
    if (project) checkContext.getStore().originalRoot = structuredClone(project)
    if (!project) throw Object.assign(new Error('没有找到项目'), { status: 404 })
    c.project = project
    const projectLevel = handler('project')
    if (projectLevel) return await projectLevel(c)
    if (episodeScoped.has(c.operation.action) && !c.operation.episodeId && (c.operation.sessionId || c.project.episodes.length)) {
      if (c.project.episodes.length !== 1) throw Object.assign(new Error('请指定 episodeId 或从对应剧集面板发起操作'), { status: 409 })
      c.operation = { ...c.operation, episodeId: c.project.episodes[0].id }
    }
    if (c.operation.episodeId && episodeScoped.has(c.operation.action)) {
      c.project = materialize(c.project, c.operation.episodeId)
      c.projects = scopeProjects(rootProjects, c.operation.episodeId, c.operation.track)
    }
    const review = handler('review')
    if (review) return await review(c)
    if (c.operation.generationMode === 'modify' && c.project.pendingImages?.[c.operation.draftId]) {
      const candidate = c.project.pendingImages[c.operation.draftId]
      if (!candidate.prompt) candidate.prompt = (await readImageDraft(home, c.operation.draftId)).metadata.prompt || ''
    }
    c.submittedReview = String(c.operation.review || '').trim()
    const prepared = await prepareChecks(c.projects, c.project, c.operation)
    c.projects = prepared.store
    c.project = prepared.project
    c.operation = prepared.operation
    if (['storyboard', 'shot-boards'].includes(c.operation.action) && !canGenerate(c.project, 'storyboard')) {
      throw Object.assign(new Error('镜头表尚未通过自检：' + (feedbackOf(c.project, 'shots').check.failures || ['请先生成并检查镜头表']).join('；')), { status: 409 })
    }
    const episodeLevel = handler('episode')
    if (episodeLevel) return await episodeLevel(c)
    throw Object.assign(new Error('不支持的面板操作'), { status: 400 })
  } catch (error) {
    if (checkContext.getStore()?.apiFailure) throw error
    const { operation: current } = c
    if (current.projectId) {
      try {
        const saved = await rootProjects.read(current.projectId)
        if (saved.activeOperation === deps.operationId) {
          if (error.code === 'CONTENT_CHECK_FAILED' && current.action === 'episode-generate' && current.episodeId) {
            await scopeProjects(rootProjects, current.episodeId, current.track).save(current.projectId, view => setCheck(structuredClone(view), current, [...feedbackOf(view, current).check.failures, error.message]))
          }
          await c.projects.save(current.projectId, { activity: null, activityError: error.message })
        }
      } catch { /* Conflicting results are discarded; the owner releases its activity in finish. */ }
    }
    throw error
  }
}
