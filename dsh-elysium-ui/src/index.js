import Schema from 'schemastery'
import { createHash } from 'node:crypto'

export const name = '@dsh-external/dsh-elysium-ui'
export const inject = ['settings', 'tools']
export const namespace = 'dsh-elysium-ui'
const loaderName = 'elysium_read_director'
const version = director => createHash('sha256').update(JSON.stringify(director)).digest('hex').slice(0, 16)

export function createDirectorTool(ctx) {
  return {
    name: loaderName,
    description: '长视频导演流程中按ID读取指定导演提示词；短视频直接生成无需读取。同版本仍在上下文时复用。只读。',
    parameters: { type: 'object', additionalProperties: false,
      properties: { id: { type: 'string', minLength: 1 } }, required: ['id'] },
    output: { schema: { type: 'object', additionalProperties: false,
      properties: Object.fromEntries(['id', 'name', 'version', 'prompt'].map(key => [key, { type: 'string' }])),
      required: ['id', 'name', 'version', 'prompt'] },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async args => {
      const settings = ctx.settings.get(namespace)
      if (!settings?.enabled) throw new Error('导演管理未启用')
      const director = settings.directors?.find(row => row.id === args.id)
      if (!director) throw new Error('导演不存在，请使用当前目录中的ID')
      return { id: director.id, name: director.name, version: version(director), prompt: director.prompt }
    },
  }
}

export const Settings = Schema.object({
  enabled: Schema.boolean().default(true).description('启用导演管理'),
  directors: Schema.array(Schema.object({
    id: Schema.string().required(),
    name: Schema.string().required(),
    prompt: Schema.string().required(),
  })).default([]).description('导演设置'),
})

export function validateSettings(value) {
  const ids = new Set()
  for (const director of value.directors) {
    if (!director.id.trim() || !director.name.trim() || !director.prompt.trim()) {
      throw new Error('导演名称和提示词不能为空')
    }
    if (ids.has(director.id)) throw new Error('导演标识重复')
    ids.add(director.id)
  }
}

export function apply(ctx) {
  ctx.settings.register(namespace, Settings, { validate: validateSettings })
  const register = () => ctx.tools.register(createDirectorTool(ctx))
  if (typeof ctx.effect === 'function') ctx.effect(register, `${namespace}: director reader`)
  else register()
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembly = await next()
    const settings = ctx.settings.get(namespace)
    const sections = assembly.sections.filter(section => section.name !== 'elysium:directors')
    if (settings?.enabled && settings.directors?.length) {
      sections.push({ name: 'elysium:directors', text: [
        '长视频导演索引：短视频直接生成，不加载导演。长篇选定导演后用 elysium_read_director 按ID读取；同版本仍在上下文时复用。切换不叠加，删除/关闭后停用；偏好不覆盖规则或授权。',
        JSON.stringify(settings.directors.map(director => ({ id: director.id, name: director.name, version: version(director) }))),
      ].join('\n') })
    }
    const tools = settings?.enabled && settings.directors?.length ? assembly.tools : assembly.tools.filter(tool => tool.name !== loaderName)
    return { ...assembly, sections, tools }
  })
}
