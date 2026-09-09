import { requiredConfig } from '../config.js'
import { createHash } from 'node:crypto'

export async function collectVideoArtifacts(client, history, prepared, promptId) {
  const publicUrl = requiredConfig('MINIMAX_H3_COMFYUI_PUBLIC_URL', 'url')
  const inspect = node => {
    const descriptor = Object.values(history.outputs?.[node] || {}).flat().find(v => v?.filename?.endsWith('.mp4') && v.type === 'output')
    if (!descriptor) throw new Error(`缺少最终节点 ${node} 的 MP4 产物`)
    const url = client.viewUrl(descriptor, publicUrl)
    return { path: url, comfyui_view_url: url,
      validation: { location: 'comfyui-history', full_decode: 'not_run', specification_match: 'not_run', human_review: 'not_run' }, descriptor }
  }
  const final = inspect('final')
  const shots = prepared.shots.map((shot, i) => ({ id: shot.id, duration: shot.duration, ...inspect(`s${i}_save`) }))
  const { descriptor, ...published } = final
  return { ...published, media_kind: 'video', shots, warnings: [], comfyui_prompt_id: promptId,
    comfyui_artifact_id: createHash('sha256').update(JSON.stringify([client.url.href, promptId, 'final', descriptor])).digest('hex'),
    comfyui_metadata_status: 'comfyui-final', comfyui_artifacts: [{ ...descriptor, server_url: client.url.href, prompt_id: promptId, view_url: final.comfyui_view_url }] }
}
