import { SettingsModel as SelectionModel } from '@agent-modules/setting'
import { settingsSpec } from '../shared/models/settings_model.js'

// meiji 的设置选择。目录在 shared，校验使用公共 SettingsModel；错误保留设置接口的 400。
export class SettingsModel {
  constructor(value) {
    try { Object.assign(this, new SelectionModel(value, settingsSpec).toJSON()) }
    catch (error) {
      if (error.code === 'INVALID_SETTINGS') error.status = 400
      throw error
    }
  }
  toJSON() {
    const { output_language, session, text, image, video } = this
    return { output_language, session: { model: session.model }, text: { model: text.model }, image: { model: image.model }, video: { model: video.model } }
  }
}
