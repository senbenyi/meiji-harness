export const operation = {
  label: '提取项目摘要', scope: 'project', agent: true, kind: 'generate',
  precheck: (project, op) => {
    if (op.draft && project) throw Object.assign(new Error('项目摘要草稿仅用于创建项目之前'), { status: 400 })
    if (!project?.script?.trim() && !(op.draft && !op.projectId && op.scriptAssetId)) throw Object.assign(new Error('请先导入剧本'), { status: 400 })
  },
  tasks: () => [{ type: 'project-summary' }],
}
