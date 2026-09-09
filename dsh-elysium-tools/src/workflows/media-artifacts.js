import { requiredConfig } from '../config.js'
import { serverMedia } from '../media/server-media.js'
import { saveJson } from '../jobs/json.js'
import { join } from 'node:path'

export async function collectMediaArtifacts(client, history, prepared, jobId, directory, promptId) {
  const expected = prepared.expected, extension = expected.kind === 'image' ? '.png' : '.mp4'
  const descriptor = Object.values(history.outputs?.['7'] || {}).flat().find(v => v?.filename?.endsWith(extension) && v.type === 'output')
  if (!descriptor) throw new Error('最终节点没有返回所需产物')
  const result = await serverMedia({ operation: 'output', descriptor, timestamps: expected.kind === 'video' }, client.signal), info = result.media_info
  if (info.width !== expected.width || info.height !== expected.height || (expected.kind === 'video' &&
    (Math.abs(info.duration_seconds-expected.duration_seconds)>0.15 || Math.abs(info.frame_rate-expected.frame_rate)>0.001 || info.has_audio!==expected.has_audio))) throw new Error('服务器产物尺寸、时长、帧率或音轨不匹配')
  if (expected.kind === 'video') {
    const vd = Number(result.probe.streams.find(s => s.codec_type === 'video')?.duration)
    const audio = result.probe.streams.find(s => s.codec_type === 'audio')
    if (!Number.isFinite(vd) || (audio && Math.abs(Number(audio.duration)-vd)>0.15) || !result.timestamps?.length ||
      result.timestamps.some((time,i)=>!Number.isFinite(time) || Math.abs(time-result.timestamps[0]-i/info.frame_rate)>0.002)) throw new Error('服务器视频时间基准或音轨不匹配')
  }
  await saveJson(join(directory,'media-server-probe.json'),result)
  return { path: result.path, server_path: result.server_path, size_bytes: result.size_bytes, sha256: result.sha256, media_kind: expected.kind, media_info: info, warnings: [],
    ...(prepared.plan.params.character ? { character: prepared.plan.params.character } : {}),
    validation: { location: 'server', full_decode: 'passed', specification_match: 'passed', human_review: 'not_run' },
    comfyui_prompt_id: promptId, comfyui_view_url: client.viewUrl(descriptor, requiredConfig('MINIMAX_H3_COMFYUI_PUBLIC_URL', 'url')),
    comfyui_metadata_status: 'comfyui-final', comfyui_artifacts: [{ ...descriptor, prompt_id: promptId }] }
}
