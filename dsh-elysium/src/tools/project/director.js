// 职责：向聊天 Agent 提供可用导演的只读清单。
const director = { type: 'object', additionalProperties: false, properties: {
  name: { type: 'string' }, style: { type: 'string' }, works: { type: 'array', items: { type: 'string' } },
}, required: ['name', 'style', 'works'] }
const output = { schema: { type: 'object', additionalProperties: false, properties: { directors: { type: 'array', items: director } }, required: ['directors'] }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }

export function createDirectorTools(store) {
  return [{
    name: 'director_list', description: '列出导演库中可用的精确名称、风格和作品；创建项目前调用，不得猜测导演名称。',
    parameters: { type: 'object', additionalProperties: false, properties: {} }, output,
    execute: async () => ({ directors: (await store.list()).map(({ name, style, works }) => ({ name, style, works })) }),
  }]
}
