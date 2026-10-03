export const operation = { label: '生成摘要', scope: 'project', agent: true, kind: 'generate', tasks: (_project, op) => [{ type: 'summary', params: { draft: Boolean(op.draft) } }] }
