import { renderRecordedRows } from '../../../../client/ui/conversation-content.js'

export const conversation = {
  renderStepOutput(body, result, tools) {
    return renderRecordedRows(body, result?.output?.shots, '分镜', tools)
  },
}
