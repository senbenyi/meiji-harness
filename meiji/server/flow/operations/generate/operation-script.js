export const sync = { label: '回写剧本', scope: 'project', lock: 'project', agent: true, kind: 'generate',
  precheck(project, op) {
    if (!project.episodes.some(item => item.id === op.episodeId) && !project.scriptPendingDeletes.some(item => item.episodeId === op.episodeId)) throw Object.assign(new Error('回写目标不存在'), { status: 404 })
  }, tasks: () => [{ type: 'script-sync' }] }
export const revise = { session: {"tool": "meiji_revise_script", "description": "按要求生成后续剧本修改方案，用户逐条确认。", "episode": false, "required": ["requirements"], "params": {"fromEpisode": {"type": "integer", "minimum": 0}}}, label: '修改后续剧情', scope: 'project', lock: 'project', agent: true, kind: 'generate',
  precheck(project, op) { if (!String(op.requirements || '').trim()) throw Object.assign(new Error('请填写剧本修改要求'), { status: 400 }); if (!project.script) throw Object.assign(new Error('尚未建立剧本'), { status: 409 }) },
  tasks: () => [{ type: 'script-revise' }] }
