import { runtimeConfig } from '../config.js'
import { sha256File } from '../functions/common/file-hash.js'
import { stat, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { requiredConfig } from '../config.js'
import { probeMedia } from '../media/probe.js'

const run = promisify(execFile)

export async function collectMediaArtifacts(client, history, prepared, jobId, directory, promptId) {
  const expected = prepared.expected, extension = expected.kind === 'image' ? '.png' : '.mp4'
  const descriptor = Object.values(history.outputs?.['7'] || {}).flat().find(v => v?.filename?.endsWith(extension) && v.type === 'output')
  if (!descriptor) throw new Error('最终节点没有返回所需产物')
  const output = join(requiredConfig('ARTIFACTS_ROOT'), `production-${jobId}`, `output/final${extension}`), candidate = output.replace(extension, `.candidate${extension}`)
  await client.download(descriptor, candidate)
  const info = await probeMedia(candidate, join(directory, 'media-probe.json'))
  if (info.width !== expected.width || info.height !== expected.height || (expected.kind === 'video' && (Math.abs(info.duration_seconds - expected.duration_seconds) > 0.15 || Math.abs(info.frame_rate - expected.frame_rate) > 0.001 || info.has_audio !== expected.has_audio))) throw new Error('产物尺寸、时长、帧率或音轨不匹配')
  await run(runtimeConfig().FFMPEG_BIN || 'ffmpeg', ['-v', 'error', '-xerror', '-nostdin', '-i', candidate, '-f', 'null', '-'], { timeout: 300000 })
  await rename(candidate, output)
  return { path: output, size_bytes: (await stat(output)).size, sha256: await sha256File(output), media_kind: expected.kind, media_info: info, warnings: [],
    ...(prepared.plan.params.character ? { character: prepared.plan.params.character } : {}),
    validation: { full_decode: 'passed', specification_match: 'passed', human_review: 'not_run' },
    comfyui_prompt_id: promptId, comfyui_view_url: client.viewUrl(descriptor, requiredConfig('MINIMAX_H3_COMFYUI_PUBLIC_URL', 'url')),
    comfyui_metadata_status: 'comfyui-final', comfyui_artifacts: [{ ...descriptor, prompt_id: promptId }] }
}
