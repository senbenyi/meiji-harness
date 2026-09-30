import { GenerationStatus } from './drama-model.js'
// 上一镜尾帧在分镜参考快照中的地址：由视频文件名确定，尾帧图片与视频同目录（<视频名>-last.png）。
export const tailFrameUrl = sourceVideoFile => `tail-frame:${sourceVideoFile}`
export function previousTail(project, shotId) {
  const index = project.shots.items.findIndex(s => s.id === shotId)
  const previous = project.shots.items[index - 1]
  const frame = previous?.tailFrame
  if (!previous || previous.video.stale || previous.video.content?.status !== 'ready' || frame?.status !== GenerationStatus.PASSED || frame.content?.sourceVideoFile !== previous.video.content?.file || !frame.content?.localPath) return null
  return { ...frame.content, sourceShotId: previous.id }
}
