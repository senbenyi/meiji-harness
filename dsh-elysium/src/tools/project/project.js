// 职责：将同一个项目 Store 的读取、创建与对象级修改暴露为聊天工具。
import { projectSummary } from '../../server/projects/service.js'

const text = { type: 'string' }
const projectId = { type: 'string', description: '项目 ID，先读取再修改。' }
const shotId = { type: 'string' }
const object = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required })
const info = { title: text, director: text }
const anchorPatch = object({
  new_role: text, label: text, description: text, image_url: text,
  source: { oneOf: [{ type: 'null' }, object({ type: { type: 'string', enum: ['job', 'material'] }, job_id: { type: 'string' } }, ['type', 'job_id'])] },
})
const shotPatch = object({
  role: text, action: text, subtitle: text, mode: text, notes: text,
  job_id: { oneOf: [{ type: 'null' }, { type: 'string' }] },
  status: { type: 'string', enum: ['pending', 'queued', 'running', 'succeeded', 'failed', 'cancelled'] },
})
const outputSchema = { type: 'object', additionalProperties: true, properties: { id: projectId, title: text }, required: ['id', 'title'] }
const listSchema = { type: 'array', items: outputSchema }

export function renderProjectResult(_args, value) {
  const { id, title, anchor_count, shot_count } = projectSummary(value)
  return [{ type: 'text', text: JSON.stringify({ id, title, anchor_count, shot_count }) }]
}

export function createCallToolsProjectActions(store) {
  return [
    {
      name: 'call_tools_project_list', description: '列出全部可见项目摘要，用于选择已有项目。',
      parameters: object({}),
      output: { schema: listSchema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: () => store.list(),
    },
    {
      name: 'call_tools_project_read', description: '读取项目完整数据和稳定镜头 ID；修改前先读取。',
      parameters: object({ project_id: projectId }, ['project_id']),
      output: { schema: outputSchema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: args => store.read(args.project_id),
    },
    {
      name: 'call_tools_project_update', description: '修改项目资料、锚点、幕或镜头。用 target 明确对象；锚点改名用 patch.new_role，镜头动作描述放在 patch.action。',
      parameters: {
        ...object({ project_id: projectId, target: { type: 'string', enum: ['info', 'anchor', 'act', 'shot'] },
          action: { type: 'string', enum: ['add', 'update', 'delete', 'move'] }, role: text, patch: { type: 'object' },
          act_index: { type: 'integer' }, id: shotId, direction: { type: 'integer', enum: [-1, 1] }, ...info }, ['project_id', 'target']),
        oneOf: [
          { properties: { target: { enum: ['info'] } } },
          { properties: { target: { enum: ['anchor'] }, action: { enum: ['add', 'update', 'delete'] }, patch: anchorPatch }, required: ['action', 'role'] },
          { properties: { target: { enum: ['act'] }, action: { enum: ['add', 'update', 'delete', 'move'] } }, required: ['action'] },
          { properties: { target: { enum: ['shot'] }, action: { enum: ['add', 'update', 'delete', 'move'] }, patch: shotPatch }, required: ['action'] },
        ],
      },
      output: { schema: outputSchema, render: renderProjectResult },
      execute: args => {
        if (args.target === 'info') return store.change('update', { id: args.project_id, title: args.title, director: args.director })
        if (args.target === 'anchor') return store.changeAnchor(args.project_id, args.action, { ...args.patch, role: args.role })
        if (args.target === 'act') return store.changeAct(args.project_id, args.action, { act_index: args.act_index, direction: args.direction, title: args.title })
        return store.changeShot(args.project_id, args.action, { ...args.patch, id: args.id, act_index: args.act_index, direction: args.direction })
      },
    },
    {
      name: 'call_tools_project_create', description: '创建空项目；先调用 call_tools_director_list，director 必须使用其返回的精确名称。返回项目 ID，不会启动视频生成。',
      parameters: object(info, ['title', 'director']),
      output: { schema: outputSchema, render: renderProjectResult },
      execute: args => store.change('create', { title: args.title, director: args.director }),
    },
  ]
}
