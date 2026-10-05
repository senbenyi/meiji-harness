export const operation = { session: {"tool": "meiji_update_project_summary", "description": "按当前剧本和 AI 创作方向立即更新项目摘要，requirements 可附修改意见。", "episode": false, "params": {}},
  label: '更新项目摘要', scope: 'project', lock: 'project', agent: true, kind: 'generate',
  precheck: project => { if (!project?.script?.trim()) throw Object.assign(new Error('尚未建立剧本'), { status: 400 }) },
  tasks: () => [{ type: 'project-summary' }],
}
