// 设置 Model：浏览器与服务端共用的语言、可选模型及严格校验。缺省语言为简体中文。
export const languageOptions = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en', label: 'English（英文）' },
]
export const modelOptions = {
  text: [{ value: 'codex-gpt', label: 'GPT（Codex 套餐）' }, { value: 'elysium-chat', label: 'elysium-chat' }, { value: 'qwen3.5:27b', label: 'Qwen3.5 27B' }],
  image: [{ value: 'gpt-image', label: 'GPT（Codex 套餐）' }, { value: 'elysium-image', label: 'elysium-image' }],
  video: [{ value: 'elysium-video', label: 'elysium-video' }],
}
export class SettingsModel {
  constructor(value) {
    const language = value?.output_language ?? 'zh-CN'
    if (!languageOptions.some(option => option.value === language)) {
      throw Object.assign(new Error('请选择有效语言'), { status: 400 })
    }
    this.output_language = language
    for (const purpose of Object.keys(modelOptions)) {
      const model = value?.[purpose]?.model
      if (!modelOptions[purpose].some(option => option.value === model)) {
        throw Object.assign(new Error(`${purpose}：请选择有效模型`), { status: 400 })
      }
      this[purpose] = { model }
    }
  }
  toJSON() { return { output_language: this.output_language, text: this.text, image: this.image, video: this.video } }
}
