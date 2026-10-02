import { secondsText } from '../../shared/seconds-content.js'
import { shotReferenceImages } from '../../shared/reference-images.js'

export function continuityReviewContext(project, shotId, currentReferences) {
  const rows = project.shots?.items || []
  const index = rows.findIndex(shot => shot.id === shotId)
  if (index < 0) return ''
  const current = rows[index]
  const previous = rows[index - 1]
  const references = item => shotReferenceImages(project, item).map((image, i) => ({ picture: `<Picture ${i + 1}>`, name: image.name, label: image.label, kind: image.kind, assetId: image.assetId }))
  const board = previous?.storyboard
  const usable = board?.check.passed === true && !board.stale && board.content?.prompt?.text
  return `\n跨镜连续性审核资料：\n完整镜头表：\n${rows.map(shot => `${shot.id} / ${shot.duration}s：${shot.content}`).join('\n')}\n当前镜头 ${current.id} 每秒指令：\n${secondsText(current.seconds.content) || '未生成'}\n当前镜头素材关联：${JSON.stringify(references(currentReferences ? { referenceSnapshot: currentReferences } : current.storyboard.content || current))}\n${!previous ? '本镜为第一镜，无前镜，不检查前镜承接。' : usable ? `前一镜 ${previous.id} 已通过的最终文本分镜：\n${board.content.prompt.text}\n前一镜素材关联（编号仅在该镜内部有效）：${JSON.stringify(references(board.content))}` : `前一镜 ${previous.id} 的最终文本分镜未生成、未通过或已过期，不作为已确认依据；不得声称最终提示词之间的连续性已验证。`}\n比较前镜结束与本镜开始的人物身份、位置、朝向、姿态、表情、服装、持物、动作进度、场景方向、机位和声音。允许上游明确的转场、时间省略与机位变化；不要因 Picture/Subject 编号不同就判身份变化。只报告具体冲突，不编造缺失信息，也不要求重复前镜剧情。`
}
