import Schema from 'schemastery'

export const name = '@dsh-external/dsh-elysium-ui'
export const inject = ['settings']
export const namespace = 'dsh-elysium-ui'

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
}
