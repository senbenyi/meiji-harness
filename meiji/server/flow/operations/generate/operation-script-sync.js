export const operation = { label: '回写剧本', scope: 'project', lock: 'project', agent: true, kind: 'generate',
  precheck(project, op) {
    if (!project.episodes.some(item => item.id === op.episodeId) && !project.scriptPendingDeletes.some(item => item.episodeId === op.episodeId)) throw Object.assign(new Error('回写目标不存在'), { status: 404 })
  }, tasks: () => [{ type: 'script-sync' }] }
