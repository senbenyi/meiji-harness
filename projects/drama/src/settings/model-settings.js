import { SettingsModel } from '@agent-modules/setting'
import { join } from 'node:path'
import { createSettingsStore } from '@agent-modules/setting/store'
import { modelClient } from '@agent-modules/http-client'

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
  const store = createSettingsStore(join(root, 'models.json'), { spec: settingsSpec, defaults: { baseUrl } })
  return {
    read: () => store.read(),
    async save(patch) {
      for (const key of Object.keys(patch))
        if (!['output_language', ...Object.keys(modelOptions)].includes(key)) throw new TypeError('未知设置字段：' + key)
      if (patch.session && onSessionModel) {
        const current = await store.read()
        const selection = new SettingsModel({ ...current, ...patch }, settingsSpec).toJSON()
        await onSessionModel({ ...current, ...selection })
      }
      return store.write(patch)
    },
    async complete(options) {
      const config = await store.read()
      return modelClient.complete({ ...options, baseUrl: config.baseUrl, model: config.text.model })
    },
    async generateImage(options) {
      const config = await store.read()
      return modelClient.generateImage({ ...options, baseUrl: config.baseUrl, model: config.image.model })
    },
    async generateVideo(options) {
      const config = await store.read()
      return modelClient.generateVideo({ ...options, baseUrl: config.baseUrl, model: config.video.model })
    },
  }
}
