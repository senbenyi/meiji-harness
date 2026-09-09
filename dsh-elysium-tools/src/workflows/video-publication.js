import { requiredConfig } from '../config.js'
import { randomUUID } from 'node:crypto'
import { sha256File } from '../functions/common/file-hash.js'
import { copyFile, mkdir, realpath, rename, stat, unlink } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'

// Publish the validated final movie, never an intermediate ComfyUI clip.
export async function publishVideo(job, {
  artifactsRoot = requiredConfig('ARTIFACTS_ROOT'),
  outputRoot = requiredConfig('MINIMAX_H3_COMFYUI_OUTPUT_ROOT'),
  publicUrl = requiredConfig('MINIMAX_H3_COMFYUI_PUBLIC_URL', 'url'),
} = {}) {
  if (job.capability !== 'workflow-video' || job.status !== 'succeeded') return
  if (!/^[0-9a-f]{32}$/.test(job.job_id) || !/^[0-9a-f]{64}$/.test(job.result?.sha256 || '')) throw new Error('Invalid video publication identity')
  const root = await realpath(artifactsRoot), source = await realpath(job.result.path)
  const rel = relative(root, source)
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || !source.endsWith('.mp4')) throw new Error('Invalid final video path')
  const info = await stat(source)
  if (!info.isFile() || !info.size || info.size !== job.result.size_bytes) throw new Error('Invalid final video size')
  const url = new URL('api/view', publicUrl.replace(/\/?$/, '/'))
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid ComfyUI public URL')
  let subfolder = `elysium/${job.job_id}`, filename = `${job.result.sha256}.mp4`
  // Single-shot finals can reuse the exact ComfyUI output; never substitute a clip for a composed final.
  for (const artifact of job.result.comfyui_artifacts || []) {
    if (artifact.type !== 'output' || !artifact.filename?.endsWith('.mp4') || artifact.server_url?.replace(/\/+$/, '') !== requiredConfig('MINIMAX_H3_COMFYUI_URL', 'url')) continue
    const candidate = join(outputRoot, artifact.subfolder || '', artifact.filename)
    const candidateRel = relative(outputRoot, candidate)
    if (candidateRel.startsWith('..') || isAbsolute(candidateRel)) continue
    const candidateInfo = await stat(candidate).catch(error => { if (error.code !== 'ENOENT') throw error })
    if (!candidateInfo?.isFile() || candidateInfo.size !== info.size) continue
    if (await sha256File(candidate) !== job.result.sha256) continue
    subfolder = artifact.subfolder || ''
    filename = artifact.filename
    break
  }
  const directory = join(outputRoot, subfolder), target = join(directory, filename)
  const existing = await stat(target).catch(error => { if (error.code !== 'ENOENT') throw error })
  if (!existing?.isFile() || existing.size !== info.size) {
    await mkdir(directory, { recursive: true })
    const temporary = `${target}.${randomUUID()}.tmp`
    try {
      await copyFile(source, temporary)
      await rename(temporary, target)
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
  }
  url.search = new URLSearchParams({ filename, type: 'output', subfolder, format: 'video/mp4' }).toString()
  job.result.comfyui_view_url = url.href
  job.result.comfyui_metadata_status = 'published-final'
}
