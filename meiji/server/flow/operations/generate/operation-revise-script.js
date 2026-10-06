export const operation = { session: {"tool": "operation-revise-script", "description": "按要求生成后续剧本修改方案，用户逐条确认。", "episode": false, "required": ["requirements"], "params": {"fromEpisode": {"type": "integer", "minimum": 0}}}, label: '修改后续剧情', scope: 'project', lock: 'project', agent: true, kind: 'generate',
  precheck(project, op) { if (!String(op.requirements || '').trim()) throw Object.assign(new Error('请填写剧本修改要求'), { status: 400 }); if (!project.script) throw Object.assign(new Error('尚未建立剧本'), { status: 409 }) },
  tasks: () => [{ type: 'script-revise' }] }
