// 项目级操作：打开/创建项目、导入素材、删除、概要、剧集增改与本集剧情生成。
import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { addEpisode, editEpisode, materialize, normalizeProject, overviewPatch, scopeProjects, writeEpisodeCover } from '../../data/episodes.js'
import { linkStore } from '../../data/workspace-links.js'
import { prepareChecks } from '../../data/review-checks.js'
import { checkContext } from '../../data/operation-context.js'
import { recordStore } from '../../data/task-store.js'
import { loadModels } from './services.js'
import { generateEpisode } from '../../generate/story.js'
import { GenerationStatus } from '../../../shared/drama-model.js'
import { skillFilePath } from '../../../skills/load.js'

export async function openIncoming(home, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) throw Object.assign(new Error('上传的文件已失效'), { status: 400 })
  const directory = join(home, 'storages', 'meiji', 'incoming', id)
  const meta = JSON.parse(await readFile(join(directory, 'meta.json'), 'utf8'))
  return { directory, file: join(directory, 'file'), mime: meta.mime, name: meta.name }
}

export async function saveIncoming(home, { name, category, mime, bytes }) {
  if (!bytes?.length) throw Object.assign(new Error('文件是空的'), { status: 400 })
  const id = randomUUID()
  const directory = join(home, 'storages', 'meiji', 'incoming', id)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'file'), bytes, { mode: 0o600 })
  await writeFile(join(directory, 'meta.json'), JSON.stringify({ name, category: category || '', mime }) + '\n', { mode: 0o600 })
  return id
}

// if (operation.action === 'open')
async function opOpen(c) {
  let { operation, deps, home, projects, trace, note } = c
  const title = String(operation.title || '').trim()
  const matches = (await projects.list()).filter(item => item.title === title)
  if (matches.length !== 1) {
    throw Object.assign(new Error(matches.length ? '有多部同名短剧，请在工作区目录里点开其中一部' : '没有找到这部短剧，请从工作区目录里选择'), { status: 404 })
  }
  await linkStore(home, deps.workspaceController).ensureProject(matches[0].id, projects)
  note(`请在片库选择《${matches[0].title}》，进入它的专属工作区`)
  return trace
}

// if (operation.action === 'create')
async function opCreate(c) {
  let { operation, deps, home, projects, trace, note } = c
  const created = await projects.create(operation.fields)
  await linkStore(home, deps.workspaceController).ensureProject(created.id, projects)
  note(`请在片库选择《${created.title}》，进入它的专属工作区`)
  note(`已创建项目 ${created.title}`)
  note(`编号 ${created.id}，画幅 ${created.aspectRatio}${created.style ? `，风格 ${created.style}` : ''}`)
  trace.result = { projectId: created.id }
  note('下一步是在项目概要里添加剧集')
  return trace
}

// if (operation.action === 'library-import')
async function opLibraryImport(c) {
  let { operation, home, library, trace, note } = c
  const incoming = await openIncoming(home, operation.incomingId)
  const metadata = await library.import(operation.category, operation.name, createReadStream(incoming.file), undefined, { guidanceType: operation.guidanceType })
  await rm(incoming.directory, { recursive: true, force: true })
  note(`已导入素材 ${metadata.originalName} 到${operation.category}`)
  note(`素材编号 ${metadata.id}`)
  return trace
}

// if (['project-delete', 'episode-delete'].includes(operation.action))
async function opProjectDelete(c) {
  let { operation, home, storedProjects, rootProjects, project, trace, note } = c
  if (operation.action === 'project-delete') {
    await storedProjects.remove(project.id)
  } else {
    const episode = project.episodes.find(item => item.id === operation.episodeId)
    if (!episode) throw Object.assign(new Error('这一集不存在'), { status: 404 })
    await rootProjects.save(project.id, async current => {
      await recordStore(home, project.id).removeEpisode(episode.id)
      await rm(join(home, 'storages', 'meiji', 'projects', project.id, 'films', episode.id), { recursive: true, force: true })
      return { episodes: current.episodes.filter(item => item.id !== episode.id) }
    })
  }
  if (operation.action === 'project-delete') checkContext.getStore().projectDeleted = true
  note(operation.action === 'project-delete' ? '已删除项目及本地视频' : '已删除本集及本地视频')
  return trace
}

// if (operation.action === 'overview')
async function opOverview(c) {
  let { operation, deps, home, rootProjects, project, trace, note } = c
  const saved = await rootProjects.save(project.id, overviewPatch(project, operation.fields))
  if (saved.workspaceId && deps.workspaceController) await linkStore(home, deps.workspaceController).ensureProject(saved.id, rootProjects)
  note(`已保存项目概要：${saved.title}`)
  note(`画幅 ${saved.aspectRatio}`)
  if (saved.style) note(`风格 ${saved.style}`)
  note(saved.summary.content)
  return trace
}

// if (operation.action === 'episode-generate')
async function opEpisodeGenerate(c) {
  let { operation, deps, rootProjects, models, project, trace, note } = c
  const existing = operation.episodeId ? project.episodes.find(episode => episode.id === operation.episodeId) : null
  if (operation.episodeId && !existing) throw Object.assign(new Error('这一集不存在'), { status: 404 })
  if (existing) {
    const prepared = await prepareChecks(scopeProjects(rootProjects, existing.id), materialize(project, existing.id), operation)
    operation = c.operation = prepared.operation
    project = normalizeProject(await rootProjects.read(project.id))
  }
  await rootProjects.save(project.id, { activity: 'episode', activityError: null })
  note('按 skill-gailan-episode-generate 生成本集剧情')
  note('操作：episode-generate（会话与面板共用）')
  note('文件：' + skillFilePath('skill-gailan-episode-generate'))
  note('函数：generateEpisode（server/generate/story.js）')
  let episodeId = existing?.id
  const persist = async draft => {
    await rootProjects.save(project.id, current => {
      const patch = episodeId ? editEpisode(current, episodeId, { summary: draft.summary, durationSeconds: existing?.durationSeconds || draft.durationSeconds }) : addEpisode(current, draft)
      const updated = episodeId ? patch.episodes.find(item => item.id === episodeId) : patch.episodes[0]
      episodeId = updated.id
      updated.summary.check = { ...(draft.check || { passed: null, failures: [] }), revision: updated.summary.revision }
      updated.summary.status = draft.check?.passed === true ? GenerationStatus.PASSED : GenerationStatus.FAILED
      return { ...patch, activity: 'episode' }
    })
  }
  const draft = await (deps.generateEpisode || generateEpisode)({ route: (await loadModels(models)).story, project, episodeId: operation.episodeId, persist })
  await persist(draft)
  trace.result = { episodeId }
  await rootProjects.save(project.id, { activity: null, activityError: null })
  note(existing ? `已重新生成第 ${project.episodes.length - project.episodes.findIndex(episode => episode.id === existing.id)} 集摘要，保留 ${existing.durationSeconds} 秒时长` : `已生成第 ${project.episodes.length + 1} 集，${draft.durationSeconds} 秒`)
  if (existing && existing.summary.content !== draft.summary) note('本集下游制作数据已重置，需要重新生成')
  note(draft.summary)
  return trace
}

// if (operation.action === 'episode-add' || operation.action === 'episode-edit')
async function opEpisodeAdd(c) {
  let { operation, home, rootProjects, project, trace, note } = c
  const patch = operation.action === 'episode-add'
    ? addEpisode(project, operation.fields)
    : editEpisode(project, operation.episodeId, operation.fields)
  const episode = operation.action === 'episode-add' ? patch.episodes[0] : patch.episodes.find(item => item.id === operation.episodeId)
  if (operation.incomingId) {
    const incoming = await openIncoming(home, operation.incomingId)
    episode.cover = await writeEpisodeCover(home, project.id, episode.id, incoming.file, incoming.mime)
    await rm(incoming.directory, { recursive: true, force: true })
  }
  const previous = project.episodes.find(item => item.id === episode.id)
  if (!previous || previous.summary.content !== episode.summary.content || previous.durationSeconds !== episode.durationSeconds) {
    episode.summary.check = { passed: null, failures: [], revision: episode.summary.revision }
    episode.summary.status = GenerationStatus.NOT_GENERATED
  }
  await rootProjects.save(project.id, patch)
  note(operation.action === 'episode-add' ? `已添加剧集，${episode.durationSeconds} 秒` : `已保存剧集，${episode.durationSeconds} 秒`)
  if (previous && (previous.summary.content !== episode.summary.content || previous.durationSeconds !== episode.durationSeconds)) {
    note('本集时长或摘要一变，这一集的简报之后会重新待审')
  }
  return trace
}

export const projectOperations = {
  'open': { stage: 'pre', run: opOpen },
  'create': { stage: 'pre', run: opCreate },
  'library-import': { stage: 'pre', run: opLibraryImport },
  'project-delete': { stage: 'project', run: opProjectDelete },
  'episode-delete': { stage: 'project', run: opProjectDelete },
  'overview': { stage: 'project', run: opOverview },
  'episode-generate': { stage: 'project', run: opEpisodeGenerate },
  'episode-add': { stage: 'project', run: opEpisodeAdd },
  'episode-edit': { stage: 'project', run: opEpisodeAdd },
}
