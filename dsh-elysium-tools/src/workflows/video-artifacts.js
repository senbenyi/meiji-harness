import { readJson, saveJson } from '../jobs/json.js'
import { requiredConfig } from '../config.js'
import { createHash } from 'node:crypto'
import { rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { sha256File } from '../functions/common/file-hash.js'
import { validateVideoArtifact } from './video-validation.js'

export async function collectVideoArtifacts(client, history, prepared, jobId, directory, output, promptId) {
  const artifactsRoot = requiredConfig('ARTIFACTS_ROOT')
  const publicUrl = requiredConfig('MINIMAX_H3_COMFYUI_PUBLIC_URL', 'url')
  const plan = prepared.plan
  const descriptor = Object.values(history.outputs?.final || {}).flat().find(v => v?.filename?.endsWith('.mp4') && v.type === 'output')
  if (!descriptor) throw new Error('ComfyUI 没有返回最终节点的 MP4，不能用中间片段交付')
  const candidate = output.replace(/\.mp4$/, '.candidate.mp4')
  const settings = prepared.settings
  const m = await verifiedDownload(client, descriptor, candidate, plan.duration, settings, join(directory, 'media-probe.json'),
    (prepared.shots.length / 2 + 1) / settings.outputFps + 0.01)
  const viewUrl = client.viewUrl(descriptor, publicUrl)
  const artifact = { ...descriptor, server_url: client.url.href, prompt_id: promptId, view_url: viewUrl, local_path: output }
  const shots = []
  for (const [index, shot] of prepared.shots.entries()) {
    const file = Object.values(history.outputs?.[`s${index}_save`] || {}).flat().find(v => v?.filename?.endsWith('.mp4') && v.type === 'output')
    if (!file) throw new Error(`缺少镜头 ${shot.id} 的可复用产物`)
    const path = join(artifactsRoot, `production-${jobId}`, 'shots', `${shot.id}.mp4`)
    const media_info = await verifiedDownload(client, file, path, shot.duration, settings, join(directory, `shot-${shot.id}-probe.json`))
    shots.push({ id: shot.id, duration: shot.duration, path,
      media_info, validation: { full_decode: 'passed', specification_match: 'passed', human_review: 'not_run' },
      comfyui_view_url: client.viewUrl(file, publicUrl) })
  }
  await rename(candidate, output)
  const sha256 = await sha256File(output), size = (await stat(output)).size
  return { path: output, size_bytes: size, sha256, media_info: m,
    validation: { file_exists: 'passed', nonempty: 'passed', media_probe: 'passed', full_decode: 'passed',
      specification_match: 'passed', human_review: 'not_run' },
    shots, warnings: [],
    comfyui_prompt_id: promptId, comfyui_artifact_id: createHash('sha256').update(JSON.stringify([client.url.href, promptId, 'final', descriptor])).digest('hex'), comfyui_view_url: viewUrl,
    comfyui_metadata_status: 'comfyui-final', comfyui_artifacts: [artifact] }
}

// A cached file is reusable only for this exact remote artifact and validation contract.
export async function verifiedDownload(client, descriptor, path, duration, settings, probePath, tolerance) {
  const key = JSON.stringify([client.url.href, descriptor, duration, settings, tolerance])
  const cachePath = `${path}.verified.json`, cache = await readJson(cachePath)
  if (cache?.key === key && await sha256File(path).catch(() => null) === cache.sha256) return cache.media_info
  const candidate = `${path}.verify.mp4`
  await client.download(descriptor, candidate)
  const media_info = await validateVideoArtifact(candidate, duration, settings, probePath, tolerance)
  const sha256 = await sha256File(candidate)
  await rename(candidate, path)
  await saveJson(cachePath, { key, sha256, media_info })
  return media_info
}
