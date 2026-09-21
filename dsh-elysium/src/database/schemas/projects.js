// 职责：校验项目身份与唯一的系统状态结构。
import { statusError } from '../../utils/errors.js'

export const validProjectId = id => typeof id === 'string' && /^(?:[a-f0-9]{8}|\d{17})$/.test(id)
export const validShotId = id => typeof id === 'string' && /^S\d+$/.test(id)
export const validJobId = id => typeof id === 'string' && /^[a-f0-9]{32}$/.test(id)
export const validEpisode = number => Number.isInteger(number) && number >= 1 && number <= 100

export function stateValue(value) {
  if (!value || typeof value !== 'object' || !value.auto || !value.anchors || !value.episodes ||
    !['fill', 'produce', null].includes(value.auto.task) || !value.auto.attempts ||
    typeof value.auto.attempts !== 'object' || typeof value.anchors !== 'object' || typeof value.episodes !== 'object') {
    throw statusError(400, '项目状态无效')
  }
  return value
}
