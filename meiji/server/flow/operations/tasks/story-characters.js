// 小任务：角色文字资料（按意见修订人物卡）
import { opCharacters } from '../shared/story-cards.js'
import { textSteps } from '../plan-steps.js'

export const operations = {
  characters: { label: '按意见修订人物卡', maxRevisions: 2, scope: 'episode', queue: 'text', agent: true, plan: () => textSteps('characters'), stage: 'episode', run: opCharacters },
}
