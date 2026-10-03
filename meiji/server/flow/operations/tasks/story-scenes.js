// 小任务：场景文字资料（按意见修订场景卡）
import { opCharacters } from '../shared/story-cards.js'
import { textSteps } from '../plan-steps.js'

export const operations = {
  scenes: { label: '按意见修订场景卡', scope: 'episode', queue: 'text', agent: true, plan: () => textSteps('scenes'), stage: 'episode', run: opCharacters },
}
