export const operation = {
  label: '提取项目摘要', scope: 'project', agent: true, kind: 'generate',
  precheck: project => { if (!project?.script?.trim()) throw Object.assign(new Error('请先导入剧本'), { status: 400 }) },
  tasks: () => [{ type: 'project-summary' }],
}
