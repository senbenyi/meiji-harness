// 小任务：道具文字资料（提取道具）
import { opCharacters } from '../shared/story-cards.js'
import { textSteps } from '../plan-steps.js'

export const operations = {
  props: { label: '提取道具', maxRevisions: 2, scope: 'episode', queue: 'text', agent: true, plan: () => textSteps('props'), stage: 'episode', run: opCharacters },
}
