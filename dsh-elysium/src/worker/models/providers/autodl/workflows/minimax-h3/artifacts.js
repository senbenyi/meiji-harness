// 职责：提取 AutoDL H3 导演工作流的分镜和最终 MP4 产物。
import { createHash } from 'node:crypto'

export function collectDirectorArtifacts(client, history, prepared, promptId) {
  const inspect = node => {
    const descriptor = Object.values(history.outputs?.[node] || {}).flat()
      .find(value => value?.filename?.endsWith('.mp4') && value.type === 'output')
    if (!descriptor) throw new Error(`缺少最终节点 ${node} 的 MP4 产物`)
    const url = client.viewUrl(descriptor)
    return { path: url, comfyui_view_url: url,
      validation: { location: 'comfyui-history', full_decode: 'not_run', specification_match: 'not_run', human_review: 'not_run' }, descriptor }
  }
  const final = inspect('final')
  const preview = Object.values(history.outputs?.[prepared.previewNode] || {}).flat()
    .find(value => value?.filename?.endsWith('.mp4') && value.type === 'output')
  const shots = prepared.shots.map((shot, index) => ({ id: shot.id, duration: shot.duration, ...inspect(`s${index}_save`) }))
  const { descriptor, ...published } = final
  return { ...published, ...(preview ? { preview_view_url: client.viewUrl(preview) } : {}),
    media_kind: 'video', mode: 'director', quality: prepared.quality, specification: prepared.specification, shots, warnings: [], comfyui_prompt_id: promptId,
    comfyui_artifact_id: createHash('sha256').update(JSON.stringify([client.url.href, promptId, 'final', descriptor])).digest('hex'),
    comfyui_metadata_status: 'comfyui-final',
    comfyui_artifacts: [{ ...descriptor, server_url: client.url.href, prompt_id: promptId, view_url: final.comfyui_view_url }] }
}
