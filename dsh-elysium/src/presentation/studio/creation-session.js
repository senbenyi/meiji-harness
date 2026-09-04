function unwrapRemote(result, label) {
  if (result && typeof result === 'object' && result.ok === false) {
    throw result.error || new Error(`${label}失败`)
  }
  return result && typeof result === 'object' && result.ok === true ? result.value : result
}

function pendingKey(projectId) {
  return `elysium.creation-session:${projectId}`
}

function makeSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function sessionCwd(sessions) {
  const list = sessions?.list?.getSnapshot?.()
  return list?.current ? list.byId?.[list.current]?.cwd : undefined
}

function savedSessionId(projectId) {
  try { return window.sessionStorage.getItem(pendingKey(projectId)) || '' } catch { return '' }
}

function saveSessionId(projectId, sessionId) {
  try { window.sessionStorage.setItem(pendingKey(projectId), sessionId) } catch {}
}

function clearSessionId(projectId) {
  try { window.sessionStorage.removeItem(pendingKey(projectId)) } catch {}
}

/** Create/adopt, seed, and open the DeepSeek conversation bound to one creative project. */
export async function openCreationSession({ ctx, sidebar, project, creation, director, openingPrompt, skill, bindSession }) {
  const sessions = ctx?.sessions || ctx?.get?.('sessions')
  if (!sessions?.create || !sessions?.binding || !sessions?.open) {
    throw new Error('当前 Harness 不支持由插件创建会话，请升级后重试')
  }
  const cwd = sessionCwd(sessions)
  if (!cwd) throw new Error('当前会话缺少工作目录，无法加载项目 Skill')

  const alreadyBound = String(creation?.conversationId || '').trim()
  const requestedId = alreadyBound || savedSessionId(project.id) || makeSessionId()
  saveSessionId(project.id, requestedId)
  const created = await sessions.create({ cwd, sessionId: requestedId })
  const sessionId = String(unwrapRemote(created, '创建会话') || requestedId)
  const binding = sessions.binding(sessionId)
  if (!binding?.session) throw new Error('会话已创建，但尚未取得会话连接，请重试')

  const title = `${director.schoolName}-${project.title}`
  unwrapRemote(await binding.session.rename(title), '命名会话')

  if (!alreadyBound) {
    await bindSession({ projectId: project.id, conversationId: sessionId, conversationTitle: title })
  }
  if (!['skill_loaded', 'story_developing', 'story_ready', 'awaiting_story_approval', 'story_approved', 'syncing_to_production', 'production_ready'].includes(creation?.status)) {
    if (!openingPrompt) throw new Error('缺少导演开场提示词，请刷新项目后重试')
    unwrapRemote(await binding.session.command(`/skill ${skill || director.skill || 'elysium-story'}`), '加载创作 Skill')
    unwrapRemote(await binding.session.prompt(
      [{ type: 'text', text: openingPrompt }],
      'queue',
      undefined,
      `elysium-opening:${project.id}`,
    ), '注入导演提示词')
    await bindSession({ projectId: project.id, conversationId: sessionId, conversationTitle: title, skillLoaded: true })
  }

  sidebar?.openTab?.({ type: 'elysium', meta: { view: 'studio', projectId: project.id, episodeId: null } }, { sessionId, cwd })
  sessions.open(sessionId)
  clearSessionId(project.id)
  return sessionId
}
