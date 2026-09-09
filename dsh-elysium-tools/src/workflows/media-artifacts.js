import { requiredConfig } from '../config.js'
import { createHash } from 'node:crypto'

export async function collectMediaArtifacts(client, history, prepared, promptId) {
  const kind = prepared.expected.kind, extension = kind === 'image' ? '.png' : '.mp4'
  const descriptor = Object.values(history.outputs?.['7'] || {}).flat().find(v => v?.filename?.endsWith(extension) && v.type === 'output')
  if (!descriptor) throw new Error('最终节点没有返回所需产物')
  const url = client.viewUrl(descriptor, requiredConfig('MINIMAX_H3_COMFYUI_PUBLIC_URL', 'url'))
  return { path: url, media_kind: kind, warnings: [],
    ...(prepared.plan.params.character ? { character: prepared.plan.params.character } : {}),
    validation: { location: 'comfyui-history', full_decode: 'not_run', specification_match: 'not_run', human_review: 'not_run' },
    comfyui_prompt_id: promptId, comfyui_view_url: url,
    comfyui_artifact_id: createHash('sha256').update(JSON.stringify([client.url.href, promptId, '7', descriptor])).digest('hex'),
    comfyui_metadata_status: 'comfyui-final', comfyui_artifacts: [{ ...descriptor, server_url: client.url.href, prompt_id: promptId, view_url: url }] }
}
