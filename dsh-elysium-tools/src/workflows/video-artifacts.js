import { createHash } from 'node:crypto'

export async function collectVideoArtifacts(client, history, prepared, promptId) {
  const descriptor = Object.values(history.outputs?.[prepared.outputNode] || {}).flat()
    .find(value => value?.filename?.endsWith('.mp4') && value.type === 'output')
  if (!descriptor) throw new Error(`缺少最终节点 ${prepared.outputNode} 的 MP4 产物`)
  const url = client.viewUrl(descriptor)
  const messages = history.status?.messages || []
  const started = messages.find(([type]) => type === 'execution_start')?.[1]?.timestamp
  const finished = messages.find(([type]) => type === 'execution_success')?.[1]?.timestamp
  return { path: url, comfyui_view_url: url, media_kind: 'video', mode: prepared.mode,
    ...(Number.isFinite(started) && Number.isFinite(finished) ? { server_execution_ms: finished - started } : {}),
    ...(prepared.specification ? { profile: 'preview', specification: prepared.specification } : {}),
    source_workflow: prepared.source, warnings: [], comfyui_prompt_id: promptId,
    validation: { location: 'comfyui-history', full_decode: 'not_run', specification_match: 'not_run', human_review: 'not_run' },
    comfyui_artifact_id: createHash('sha256').update(JSON.stringify([client.url.href, promptId, prepared.outputNode, descriptor])).digest('hex'),
    comfyui_metadata_status: 'comfyui-final',
    comfyui_artifacts: [{ ...descriptor, server_url: client.url.href, prompt_id: promptId, view_url: url }] }
}
