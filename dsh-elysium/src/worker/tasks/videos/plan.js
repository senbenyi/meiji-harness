// 职责：定义业务模式词汇，并将参数校验交给唯一平台入口。
import { validateBackendPlan, resolveServer } from '../../models/managers/runtime/index.js'
import { runtimeConfig } from '../../../config.js'

export const VIDEO_MODES = Object.freeze(['t2va', 'i2va', 'fl2va', 'fl2va-loop', 'r2va'])
export const VIDEO_PROFILES = Object.freeze(['preview', 'regular', 'high-quality', 'standard'])
export const MODE_MEDIA = Object.freeze({
  t2va: [],
  i2va: ['first_frame'],
  fl2va: ['first_frame', 'last_frame'],
  'fl2va-loop': ['first_frame', 'last_frame'],
  r2va: ['reference_image_1', 'reference_image_2'],
})

export const validateVideoPlan = args => validateBackendPlan(runtimeConfig().ELYSIUM_BACKEND || resolveServer(), args)
