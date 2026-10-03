import { allNodes, shotMap } from '../shared/drama-model.js'

// 剧集是否有进行中的操作：以内容节点上的 operation 为准（等待人工确认的候选图不算）。
const episodeRunning = episode => allNodes(episode).some(node => node.operation && node.operation.phase !== 'awaiting-confirmation')
const sessionPattern = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function sessionIdFromStorage(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem?.('dsh.sessions.current') || '')
    return sessionPattern.test(parsed?.sessionId) ? parsed.sessionId : ''
  } catch {
    return ''
  }
}

export function currentSessionId(doc = document) {
  return sessionIdFromStorage(doc.defaultView?.localStorage)
}

function filmRows(films, prefix = '') {
  return Object.keys(films || {}).sort().map(track => `${prefix}${track}:${films[track]?.status || ''}:${films[track]?.url || ''}`)
}

function filmMark(project) {
  const rows = filmRows(shotMap(project, 'video'))
  for (const episode of project.episodes || []) rows.push(...filmRows(shotMap(episode, 'video'), `${episode.id}:`))
  return rows.sort().join(',')
}

function boardMark(project) {
  const rows = Object.entries(shotMap(project, 'pencil')).map(([track, board]) => `${track}:${board?.url || ''}`)
  for (const episode of project.episodes || []) {
    for (const [track, board] of Object.entries(shotMap(episode, 'pencil'))) rows.push(`${episode.id}:${track}:${board?.url || ''}`)
  }
  return rows.sort().join(',')
}

function pendingMark(project) {
  const rows = Object.keys(project.pendingImages || {}).sort().map(id => id)
  for (const episode of project.episodes || []) {
    rows.push(`${episode.id}:${episodeRunning(episode) ? 'running' : ''}:${Object.keys(episode.pendingImages || {}).sort().join(',')}`)
  }
  return rows.join(';')
}

export function projectRefreshMark(project) {
  return [project.updatedAt, filmMark(project), boardMark(project), pendingMark(project)].join('|')
}

export function createBridge({ request, jsonBody, showProject, onDeleted, status }) {
  let timer
  const watch = (project, listBefore) => {
    clearInterval(timer)
    let sawBusy = false
    let mark = project ? projectRefreshMark(project) : ''
    timer = setInterval(async () => {
      try {
        if (!project) {
          const { projects } = await request('projects')
          const created = projects.find(item => item.lifecycle === 'in-progress' && !listBefore.has(item.id))
          if (created) { clearInterval(timer); showProject(created); status('项目已创建') }
          return
        }
        const { project: next } = await request('projects/' + project.id)
        const clips = [
          ...Object.values(shotMap(next, 'video')),
          ...(next.episodes || []).flatMap(episode => Object.values(shotMap(episode, 'video'))),
        ]
        const filmRunning = clips.some(clip => clip?.status === 'running')
        // 是否在执行：内容节点上有进行中的操作（服务端不再保存剧集 activity）。
        const busy = (next.episodes || []).some(episodeRunning) || filmRunning
        if (busy) sawBusy = true
        const nextMark = projectRefreshMark(next)
        if (nextMark !== mark) {
          mark = nextMark
          showProject(next)
        }
        if (sawBusy && !busy) clearInterval(timer)
      } catch (error) {
        status(error.message)
        clearInterval(timer)
      }
    }, 1500)
  }
  return {
    async stage(file, category = '') {
      const { incomingId } = await request('incoming', {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-Meiji-Request': '1',
          'X-Meiji-Name': encodeURIComponent(file.name || 'upload'),
          'X-Meiji-Category': category,
        },
        body: file,
      })
      return incomingId
    },
    async perform(project, action, fields = {}) {
      const sessionId = currentSessionId()
      if (!sessionId) throw new Error('没有打开的会话，无法关联任务日志')
      let listBefore
      if (!project) {
        const { projects } = await request('projects')
        listBefore = new Set(projects.map(item => item.id))
      }
      const result = await request('turn', { method: 'POST', ...jsonBody({ sessionId, action, projectId: project?.id, ...fields }) })
      if (result.completed) {
        clearInterval(timer)
        if (result.deleted) await onDeleted()
        else if (result.project) showProject(result.project)
        status('已完成')
        return
      }
      status('任务已启动')
      if (!project) watch(project, listBefore)
    },
  }
}
