import { renderRecordedRows } from '../../../../client/ui/conversation-content.js'

export const conversation = {
  renderStepOutput(body, result, tools) {
    return renderRecordedRows(body, result?.output?.segments, '故事大纲', tools)
  },
}
