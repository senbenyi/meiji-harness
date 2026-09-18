// 职责：只向 AI 暴露当前生成请求的读取和结果回写；不提供审核授权工具。
export function createProjectWorkflowTools(workflow) {
  const text = { type: 'string' }, object = properties => ({ type: 'object', properties, additionalProperties: false })
  const base = { project_id: text, request_id: text }
  const shot = object({ id: text, duration: { type: 'integer', minimum: 1, maximum: 15 }, action: text, prompt: text,
    mode: { type: 'string', enum: ['independent', 'continue'] }, role: text, subtitle: text, notes: text,
    framing: text, camera: text, lighting: text, sound: text, reference_id: text, scene: text,
    characters: { type: 'array', items: text }, props: { type: 'array', items: text } })
  shot.required = ['id', 'duration', 'action', 'prompt', 'mode', 'characters', 'props', 'scene', 'reference_id', 'framing', 'camera', 'lighting', 'sound']
  const output = { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }
  return [
    { name: 'project_generation_read', description: '读取页面下一步创建的生成请求。小说按 next_offset 分页，必须读取相关章节后创作。素材为空时保持空。',
      parameters: { ...object({ ...base, reference_offset: { type: 'integer', minimum: 0 } }), required: ['project_id', 'request_id'] }, output,
      execute: (args, exec) => workflow.context(args.project_id, args.request_id, exec?.agent?.session?.id, args.reference_offset || 0) },
    { name: 'project_generation_complete', description: '只完成当前请求：plot 为 200 字以内剧情；storyboard 提交 shots。每镜 1～15 秒，含 action/prompt/景别/运镜/光线/声音，引用仅限选中素材 ID。没有图片参考时先用一个完整短镜头；多镜头独立镜头需 reference_id，续接用 continue。提交后停止等待用户审核。',
      parameters: { ...object({ ...base, plot: text, shots: { type: 'array', items: shot } }), required: ['project_id', 'request_id'] },
      output: { ...output, render: (_args, value) => [{ type: 'text', text: JSON.stringify({ id: value.id, stage: value.workflow.stage, plot: value.workflow.plot, shots: value.acts, notice: '已保存，请在项目中查看并继续。' }) }] },
      execute: (args, exec) => workflow.complete({ ...args, id: args.project_id }, exec?.agent?.session?.id) },
  ]
}
