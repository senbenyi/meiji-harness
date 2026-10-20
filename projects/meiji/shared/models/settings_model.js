// 浏览器与服务端共用的语言和模型选项。校验由 @agent-modules/setting 的 SettingsModel 完成。
export const languageOptions = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en', label: 'English（英文）' },
]
const textModels = [{ value: 'qwen3.5:27b', label: 'Qwen3.5 27B' }, { value: 'codex-gpt', label: 'GPT（Codex 套餐）' }]
export const modelOptions = {
  session: textModels,
  text: textModels,
  image: [{ value: 'krea2 turbo V2.5', label: 'krea2 turbo V2.5' }, { value: 'gpt-image', label: 'GPT（Codex 套餐）' }],
  video: [{ value: 'MiniMax-H3', label: 'MiniMax H3' }],
}
export const settingsSpec = {
  language: { field: 'output_language', options: languageOptions, default: 'zh-CN' },
  models: {
    session: { options: modelOptions.session, default: 'codex-gpt' },
    text: { options: modelOptions.text },
    image: { options: modelOptions.image },
    video: { options: modelOptions.video, legacy: { 'elysium-video': 'MiniMax-H3' } },
  },
}
