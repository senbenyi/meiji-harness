// 职责：聊天 Agent 只读取项目或调用与工作台相同的文档生成入口。
const object = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required })
const id = { type: 'string', description: '项目 ID' }
const output = { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }

export function createCallToolsProjectActions(store) {
  return [
    { name: 'call_tools_project_list', description: '列出可见项目摘要。', parameters: object({}),
      output: { ...output, schema: { type: 'array', items: { type: 'object', additionalProperties: true } } }, execute: () => store.list() },
    { name: 'call_tools_project_read', description: '读取项目 Markdown、总览和指定分集。',
      parameters: object({ project_id: id, episode: { type: 'integer', minimum: 1, maximum: 100 } }, ['project_id']), output,
      execute: args => args.episode ? store.readEpisode(args.project_id, args.episode) : store.read(args.project_id) },
    { name: 'call_tools_project_doc_generate', description: '使用项目工作台同一入口生成总览、剧本或分镜 Markdown。',
      parameters: object({ project_id: id, step: { type: 'string', enum: ['series', 'script', 'storyboard'] },
        episode: { type: 'integer', minimum: 1, maximum: 100 } }, ['project_id', 'step']), output,
      execute: args => store.planning.generate({ id: args.project_id, step: args.step, episode: args.episode }) },
  ]
}
