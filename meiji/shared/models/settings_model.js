// 设置 Model：浏览器与服务端共用的可选模型及严格校验。
export const modelOptions = {
  text: [{ value: 'elysium-chat', label: '接口' }, { value: 'qwen3.5:27b', label: 'Qwen3.5 27B' }],
  image: [{ value: 'elysium-image', label: '接口' }],
  video: [{ value: 'elysium-video', label: '接口' }],
}
export class SettingsModel {
  constructor(value) {
    for (const purpose of Object.keys(modelOptions)) {
      const model = value?.[purpose]?.model
      if (!modelOptions[purpose].some(option => option.value === model)) {
        throw Object.assign(new Error(`${purpose}：请选择有效模型`), { status: 400 })
      }
      this[purpose] = { model }
    }
  }
  toJSON() { return { text: this.text, image: this.image, video: this.video } }
}
