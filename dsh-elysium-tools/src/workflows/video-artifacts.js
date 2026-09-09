import { requiredConfig } from '../config.js'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { saveJson } from '../jobs/json.js'
import { serverMedia } from '../media/server-media.js'

export async function collectVideoArtifacts(client, history, prepared, jobId, directory, output, promptId) {
  const publicUrl = requiredConfig('MINIMAX_H3_COMFYUI_PUBLIC_URL', 'url')
  const inspect = async (node, duration, tolerance) => {
    const descriptor = Object.values(history.outputs?.[node] || {}).flat().find(v => v?.filename?.endsWith('.mp4') && v.type === 'output')
    if (!descriptor) throw new Error(`缺少最终节点 ${node} 的 MP4 产物`)
    const result = await serverMedia({ operation: 'output', descriptor }, client.signal)
    const m = result.media_info, settings = prepared.settings
    const vd = Number(result.probe.streams.find(s => s.codec_type === 'video')?.duration)
    const ad = Number(result.probe.streams.find(s => s.codec_type === 'audio')?.duration)
    if (m.width !== settings.outputWidth || m.height !== settings.outputHeight ||
      Math.abs(m.frame_rate - settings.outputFps) > 0.001 || m.video_codec !== 'h264' || m.audio_codec !== 'aac' ||
      !Number.isFinite(vd) || !Number.isFinite(ad) || Math.abs(ad-vd) > 0.15 || Math.abs(vd-duration) > tolerance) throw new Error('服务器产物未通过时长、画幅、帧率或音视频规格验证')
    await saveJson(join(directory, `${node}-server-probe.json`), result)
    return { path: result.path, server_path: result.server_path, sha256: result.sha256, size_bytes: result.size_bytes,
      media_info: m, comfyui_view_url: client.viewUrl(descriptor, publicUrl),
      validation: { location: 'server', full_decode: 'passed', specification_match: 'passed', human_review: 'not_run' }, descriptor }
  }
  const final = await inspect('final', prepared.plan.duration, (prepared.shots.length/2+1)/prepared.settings.outputFps+0.01)
  const shots = []
  for (const [i, shot] of prepared.shots.entries()) shots.push({ id: shot.id, duration: shot.duration,
    ...await inspect(`s${i}_save`, shot.duration, 1/prepared.settings.outputFps+0.01) })
  return { ...final, media_kind: 'video', shots, warnings: [], comfyui_prompt_id: promptId,
    comfyui_artifact_id: createHash('sha256').update(JSON.stringify([client.url.href, promptId, 'final', final.descriptor])).digest('hex'),
    comfyui_metadata_status: 'comfyui-final', comfyui_artifacts: [{ ...final.descriptor, server_url: client.url.href, prompt_id: promptId, view_url: final.comfyui_view_url }] }
}
