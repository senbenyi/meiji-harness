// 职责：从本地任务状态组装素材摘要，并按筛选与分页返回可用产物。
import { readdir, readFile, stat, mkdir, rename, rm, open } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { join, extname, basename } from 'node:path'
import { getJob, jobSummary, openLocalMedia, saveStatus } from '../../worker/index.js'
import { readJson, saveJson } from '../../database/json.js'
import { invalidRequest } from '../http.js'
import { jobsRoot, projectsRoot, uploadsRoot } from '../../database/paths.js'
import { addMaterial, removeMaterial, syncMaterials } from '../../database/managers/materials.js'

export async function availableJobSummary(job) {
  const summary = jobSummary(job)
  if (job.result?.local_media_path !== undefined) {
    try { const media = await openLocalMedia(job); await media.handle.close() }
    catch (error) { return { ...summary, has_image: false, has_video: false, has_download: false, media_error: error.message } }
  }
  return summary
}

export function assetSummary(job) {
  const prompt = typeof job.debug?.effective_input?.prompt === 'string' ? job.debug.effective_input.prompt.trim() : ''
  return { ...jobSummary(job), title: job.title, prompt_excerpt: prompt.slice(0, 500) }
}

// 从素材库移除产物，保留任务与原文件供已有项目引用。
export async function deleteAsset(jobId) {
  const job = await getJob(jobId)
  if (job.status !== 'succeeded') throw invalidRequest('只能删除已完成素材')
  await syncMaterials((await discoverMaterials()).map(item => item.material))
  return removeMaterial(jobId)
}

// 流式接收本地图片或视频，在文件与登记写完后发布到素材库。
export async function uploadAsset(req, filename) {
  const extension = extname(filename || '').toLowerCase()
  const kinds = { '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.mp4': 'video' }
  const kind = kinds[extension]
  if (!kind) throw invalidRequest('请选择 PNG、JPEG、WebP 图片或 MP4 视频')
  const id = randomBytes(16).toString('hex'), root = uploadsRoot()
  const temporary = join(root, `${id}.tmp`), path = `media/${id}${extension}`
  let size = 0, header = Buffer.alloc(0)
  await mkdir(join(temporary, 'media'), { recursive: true })
  try {
    const file = await open(join(temporary, path), 'wx', 0o600)
    try {
      for await (const chunk of req) {
        const bytes = Buffer.from(chunk); size += bytes.length
        if (size > 512 * 1024 * 1024) throw Object.assign(new Error('素材文件最多 512 MB'), { status: 413 })
        if (header.length < 12) header = Buffer.concat([header, bytes.subarray(0, 12 - header.length)])
        await file.writeFile(bytes)
      }
    } finally { await file.close() }
    const valid = extension === '.png' ? header.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      : ['.jpg', '.jpeg'].includes(extension) ? header.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))
      : extension === '.webp' ? header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP'
      : header.toString('ascii', 4, 8) === 'ftyp'
    if (!size || !valid) throw invalidRequest('文件内容与图片或视频格式不符')
    const job = { job_id: id, backend: 'upload', title: basename(filename).slice(0, 200), status: 'succeeded', result: { media_kind: kind, local_media_path: path } }
    await saveJson(join(temporary, 'media', 'manifest.json'), { files: [{ path, job_id: id, size_bytes: size }] })
    await saveStatus(temporary, job)
    await rename(temporary, join(root, id))
    await addMaterial({ job_id: id, source: 'import' })
    return assetSummary(job)
  } finally { await rm(temporary, { recursive: true, force: true }) }
}

async function discoverMaterials() {
  const sources = [{ directory: jobsRoot(), creation: true }, { directory: uploadsRoot(), creation: false }]
  const discovered = []
  for (const source of sources) {
    const jobs = await readdir(source.directory, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
    for (const entry of jobs) {
      if (!entry.isDirectory() || !/^[a-f0-9]{32}$/.test(entry.name)) continue
      const path = join(source.directory, entry.name, 'status.json')
      try {
        const job = JSON.parse(await readFile(path, 'utf8'))
        if (job.status !== 'succeeded') continue
        const deleted = await readJson(join(source.directory, entry.name, 'asset-deleted.json'))
        discovered.push({ job, path, material: { job_id: job.job_id, source: source.creation ? 'creation' : 'import',
          ...(source.creation ? { project_id: job.project_id } : {}),
          ...(deleted ? { deleted: true } : {}) } })
      } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error }
    }
  }
  return discovered
}

export async function listAssets(offset, limit, filters = {}) {
  const discovered = await discoverMaterials()
  const catalog = await syncMaterials(discovered.map(item => item.material))
  const active = new Set(catalog.filter(item => !item.deleted).map(item => item.job_id))
  const projectMaterials = new Set()
  if (filters.source === 'project') {
    const projects = await readdir(projectsRoot(), { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
    for (const project of projects.filter(project => project.isDirectory() && /^[a-f0-9]{8}$/.test(project.name))) {
      const directory = join(projectsRoot(), project.name)
      const materials = await readJson(join(directory, 'materials.json'))
      const metadata = materials ? null : await readJson(join(directory, 'project.json'))
      for (const id of materials || metadata?.materials || []) projectMaterials.add(id)
    }
  }
  const items = []
  for (const { job, path, material } of discovered) {
    if (!active.has(job.job_id)) continue
    if (filters.source === 'creation' && material.source !== 'creation' || filters.source === 'import' && material.source !== 'import' || filters.source === 'project' && !projectMaterials.has(job.job_id)) continue
    try {
      const summary = { ...assetSummary(job), ...await availableJobSummary(job) }
      if (filters.q && ![job.job_id, job.title, job.debug?.effective_input?.prompt].some(text => typeof text === 'string' && text.toLowerCase().includes(filters.q.toLowerCase()))) continue
      const wantedQuality = filters.quality || ({ preview: 'fast', regular: 'regular', 'high-quality': 'high', hd: 'high' })[filters.profile]
      if (job.status === 'succeeded' && (!wantedQuality || summary.quality === wantedQuality) && (!filters.media_kind || summary.media_kind === filters.media_kind)) items.push({ ...summary, created_at: (await stat(path)).mtimeMs })
    } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error }
  }
  items.sort((a, b) => b.created_at - a.created_at || a.job_id.localeCompare(b.job_id))
  return { items: items.slice(offset, offset + limit), total: items.length, has_more: offset + limit < items.length }
}
