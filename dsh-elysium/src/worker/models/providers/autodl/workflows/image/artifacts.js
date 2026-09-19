// 职责：从 AutoDL ComfyUI 历史记录提取图片结果和角色身份元数据。
import { createHash } from 'node:crypto'

export function collectImageArtifacts(client, history, prepared, promptId) {
  const descriptor = Object.values(history.outputs?.[prepared.outputNode] || {}).flat()
    .find(value => value?.filename?.endsWith('.png') && value.type === 'output')
  if (!descriptor) throw new Error(`最终节点 ${prepared.outputNode} 没有返回 PNG 产物`)
  const url = client.viewUrl(descriptor)
  return { path: url, media_kind: 'image', quality: prepared.quality, specification: prepared.specification, warnings: [],
    ...(prepared.plan.params.character ? { character: prepared.plan.params.character } : {}),
    validation: { location: 'comfyui-history', full_decode: 'not_run', specification_match: 'not_run', human_review: 'not_run' },
    comfyui_prompt_id: promptId, comfyui_view_url: url,
    comfyui_artifact_id: createHash('sha256').update(JSON.stringify([client.url.href, promptId, prepared.outputNode, descriptor])).digest('hex'),
    comfyui_metadata_status: 'comfyui-final',
    comfyui_artifacts: [{ ...descriptor, server_url: client.url.href, prompt_id: promptId, view_url: url }] }
}
