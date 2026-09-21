// 职责：向聊天 Agent 提供可用导演的只读清单。
const director = { type: 'object', additionalProperties: false, properties: {
  name: { type: 'string' }, display_name: { type: 'string' }, description: { type: 'string' }, order: { type: 'number' },
}, required: ['name', 'display_name', 'description', 'order'] }
const output = { schema: { type: 'object', additionalProperties: false, properties: { directors: { type: 'array', items: director } }, required: ['directors'] }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }

export function createCallToolsDirectorList(store) {
  return [{
    name: 'call_tools_director_list', description: '列出可用导演 Skill 的名称、显示名和描述；创建项目前调用，完整内容通过 Skill 加载。',
    parameters: { type: 'object', additionalProperties: false, properties: {} }, output,
    execute: async () => ({ directors: await store.list() }),
  }]
}
