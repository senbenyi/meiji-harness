// 职责：将同一个项目 Store 的读取、创建与项目资料修改暴露为聊天工具；分镜与锚点只由规划定稿产生。
import { projectSummary } from '../../server/projects/service.js'

const text = { type: 'string' }
const projectId = { type: 'string', description: '项目 ID，先读取再修改。' }
const episode = { type: 'integer', minimum: 1, maximum: 100, description: '集数；按集读取分镜时填写。' }
const object = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required })
const info = { title: text, director: text, genre: text, synopsis: text }
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
      parameters: object({ project_id: projectId, episode }, ['project_id']),
      output: { schema: outputSchema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: args => args.episode === undefined ? store.read(args.project_id) : store.readEpisode(args.project_id, args.episode),
    },
    {
      name: 'call_tools_project_update', description: '修改项目名称、导演、题材或梗概。',
      parameters: object({ project_id: projectId, ...info }, ['project_id']),
      output: { schema: outputSchema, render: renderProjectResult },
      execute: ({ project_id: id, ...patch }) => store.change('update', { id, ...patch }),
    },
    {
      name: 'call_tools_project_create', description: '创建空项目；先调用 call_tools_director_list 选择导演；封面可选，为已完成的图片素材任务 ID。返回项目 ID，不会启动视频生成。',
      parameters: object({ ...info, cover_job_id: { type: 'string', description: '已完成的封面图片素材任务 ID（可选）。' } }, ['title', 'director']),
      output: { schema: outputSchema, render: renderProjectResult },
      execute: args => store.change('create', args),
    },
  ]
}
