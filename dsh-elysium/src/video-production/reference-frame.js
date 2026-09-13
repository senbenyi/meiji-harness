// 职责：解析分镜锚点并生成可复用的参考帧请求。
import { createHash } from 'node:crypto'
import { saveJson } from '../jobs/store.js'

export async function extractReference({ client, projectId, shotId, source, definition, paths }) {
  const media = new URL(source.comfyui_view_url)
  const filename = media.searchParams.get('filename'), subfolder = media.searchParams.get('subfolder') || ''
  if (!filename || media.searchParams.get('type') !== 'output') throw new Error(`${shotId}: 视频结果不是有效的 ComfyUI output URL`)
  const graph = {
    '1': { class_type: 'LoadVideo', inputs: { file: `${subfolder}/${filename} [output]` } },
    '2': { class_type: 'GetVideoComponents', inputs: { video: ['1', 0] } },
    '3': { class_type: 'ImageFromBatch', inputs: { image: ['2', 0], batch_index: definition.frame_index, length: 1 } },
    '4': { class_type: 'SaveImage', inputs: { images: ['3', 0], filename_prefix: `productions/${projectId}/references/${definition.id}` } },
  }
  await saveJson(paths.referenceGraph, graph)
  const submissionId = createHash('sha256').update(`production:${projectId}:${shotId}:reference:${definition.id}`).digest('hex').slice(0, 32)
  await client.validate(graph)
  const promptId = await client.submit(graph, submissionId, paths.referenceSubmission)
  const result = await client.wait(promptId, 180_000)
  const descriptor = result.outputs?.['4']?.images?.[0]
  return { url: client.viewUrl(descriptor), prompt_id: promptId, source_job_id: source.job_id, source_shot_id: shotId, frame_index: definition.frame_index }
}
