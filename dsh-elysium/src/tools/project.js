// 职责：将同一个项目 Store 的读取、创建与对象级修改暴露为聊天工具。
import { projectSummary } from '../business/projects/store.js'

const text = { type: 'string' }
const projectId = { type: 'string', description: '项目 ID，先读取再修改。' }
const shotId = { type: 'string' }
const object = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required })
const info = { title: text, director: text, profile: { type: 'string', enum: ['preview', 'regular', 'high-quality', 'hd'] } }
const anchorPatch = object({
  new_role: text, label: text, description: text, image_url: text,
  source: { oneOf: [{ type: 'null' }, object({ type: { type: 'string', enum: ['job', 'material'] }, job_id: { type: 'string' } }, ['type', 'job_id'])] },
})
const shotPatch = object({
  role: text, action: text, subtitle: text, mode: text, notes: text,
  job_id: { oneOf: [{ type: 'null' }, { type: 'string' }] },
  status: { type: 'string', enum: ['pending', 'queued', 'running', 'succeeded', 'failed'] },
})
const outputSchema = { type: 'object', additionalProperties: true, properties: { id: projectId, title: text }, required: ['id', 'title'] }

export function renderProjectResult(_args, value) {
  const { id, title, anchor_count, shot_count } = projectSummary(value)
  return [{ type: 'text', text: JSON.stringify({ id, title, anchor_count, shot_count }) }]
}

export function createProjectTools(store) {
  return [
    {
      name: 'project_read', description: '读取项目完整数据和稳定镜头 ID；修改前先读取。',
      parameters: object({ project_id: projectId }, ['project_id']),
      output: { schema: outputSchema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: args => store.read(args.project_id),
    },
    {
      name: 'project_update_anchor', description: '添加、局部修改或删除一个锚点；改名用 patch.new_role，自动更新镜头引用。',
      parameters: object({ project_id: projectId, action: { type: 'string', enum: ['add', 'update', 'delete'] }, role: text, patch: anchorPatch }, ['project_id', 'action', 'role']),
      output: { schema: outputSchema, render: renderProjectResult },
      execute: args => store.changeAnchor(args.project_id, args.action, { ...args.patch, role: args.role }),
    },
    {
      name: 'project_update_shot', description: '操作单个镜头。新增需 act_index（从0开始），修改/删除/移动需 id；移动 direction 为±1。镜头动作描述放在 patch.action，只传需修改字段。',
      parameters: object({ project_id: projectId, action: { type: 'string', enum: ['add', 'update', 'delete', 'move'] }, id: shotId, act_index: { type: 'integer' }, direction: { type: 'integer', enum: [-1, 1] }, patch: shotPatch }, ['project_id', 'action']),
      output: { schema: outputSchema, render: renderProjectResult },
      execute: args => store.changeShot(args.project_id, args.action, { ...args.patch, id: args.id, act_index: args.act_index, direction: args.direction }),
    },
    {
      name: 'project_update_info', description: '仅修改项目名称、导演或档次；不会替换角色和分镜。',
      parameters: object({ project_id: projectId, ...info }, ['project_id']),
      output: { schema: outputSchema, render: renderProjectResult },
      execute: args => store.change('update', { id: args.project_id, title: args.title, director: args.director, profile: args.profile }),
    },
    {
      name: 'project_create', description: '创建空项目；先调用 director_list，director 必须使用其返回的精确名称。返回项目 ID，不会启动视频生成。',
      parameters: object(info, ['title', 'director', 'profile']),
      output: { schema: outputSchema, render: renderProjectResult },
      execute: args => store.change('create', { title: args.title, director: args.director, profile: args.profile }),
    },
  ]
}
