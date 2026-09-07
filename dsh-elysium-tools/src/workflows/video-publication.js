import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, realpath, rename, stat, unlink } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'

// Publish the validated final movie, never an intermediate ComfyUI clip.
export async function publishVideo(job, {
  artifactsRoot = process.env.ARTIFACTS_ROOT || '/root/autodl-fs/artifacts/projects',
  outputRoot = process.env.MINIMAX_H3_COMFYUI_OUTPUT_ROOT || join(process.env.MINIMAX_H3_COMFYUI_ROOT || '/root/autodl-tmp/ComfyUI-minimax-h3', 'output'),
  publicUrl = process.env.MINIMAX_H3_COMFYUI_PUBLIC_URL || 'http://127.0.0.1:6016',
} = {}) {
  if (job.capability !== 'workflow-video' || job.status !== 'succeeded') return
  if (!/^[0-9a-f]{32}$/.test(job.job_id) || !/^[0-9a-f]{64}$/.test(job.result?.sha256 || '')) throw new Error('Invalid video publication identity')
  const root = await realpath(artifactsRoot), source = await realpath(job.result.path)
  const rel = relative(root, source)
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || !source.endsWith('.mp4')) throw new Error('Invalid final video path')
  const info = await stat(source)
  if (!info.isFile() || !info.size || info.size !== job.result.size_bytes) throw new Error('Invalid final video size')
  const url = new URL('view', publicUrl.replace(/\/?$/, '/'))
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid ComfyUI public URL')
  const subfolder = `elysium/${job.job_id}`, filename = `${job.result.sha256}.mp4`
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
  url.search = new URLSearchParams({ filename, subfolder, type: 'output' }).toString()
  job.result.comfyui_view_url = url.href
  job.result.comfyui_metadata_status = 'published-final'
}
