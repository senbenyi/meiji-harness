export const operation = { session: { tool: 'operation-sync-script', description: '明确授权后回写本集摘要到剧本；可能产生待用户确认的方案。', episode: true, params: {} }, label: '回写剧本', scope: 'project', lock: 'project', agent: true, kind: 'generate',
  precheck(project, op) {
    if (!project.episodes.some(item => item.id === op.episodeId) && !project.scriptPendingDeletes.some(item => item.episodeId === op.episodeId)) throw Object.assign(new Error('回写目标不存在'), { status: 404 })
  }, tasks: () => [{ type: 'script-sync' }] }
