import { join } from 'node:path'
import { createSettingsService } from '@agent-modules/setting/service'
import { createConfiguredModelClient } from '@agent-modules/http-client/configured-client'

const gpt = { value: 'codex-gpt', label: 'GPT' }
export const modelOptions = {
  session: [gpt],
  text: [gpt, { value: 'qwen3.5:27b', label: 'Qwen3.5 27B' }],
  image: [{ value: 'gpt-image', label: 'GPT Image' }, { value: 'krea2 turbo V2.5', label: 'Krea2 Turbo V2.5' }],
  video: [{ value: 'MiniMax-H3', label: 'MiniMax H3' }],
}
export const settingsSpec = {
  language: { field: 'output_language', default: 'zh-CN', options: [{ value: 'zh-CN', label: '简体中文' }, { value: 'en', label: 'English' }] },
  models: Object.fromEntries(Object.entries(modelOptions).map(([kind, options]) => [kind, { options, default: options[0].value }])),
}

export function createModelSettings(root, { onSessionModel, baseUrl = process.env.DRAMA_MODEL_BASE_URL || 'http://127.0.0.1:11435/v1' } = {}) {
  const settings = createSettingsService({
    file: join(root, 'models.json'), spec: settingsSpec, defaults: { baseUrl },
    beforeSave: async ({ patch, next }) => {
      if (Object.hasOwn(patch, 'session') && onSessionModel) await onSessionModel(next)
    },
  })
  const client = createConfiguredModelClient({ settings,
    methods: { complete: 'text', generateImage: 'image', generateVideo: 'video' },
  })
  return { ...settings, ...client }
}
