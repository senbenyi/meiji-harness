// 职责：将项目任务定位到所属项目目录，并按任务 ID 查找已有任务。
import { access, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { requiredConfig } from '../../config.js'

export const FREE_PROJECT_ID = '00000000'
export const validProjectId = value => /^[a-f0-9]{8}$/.test(value || '')
export const validJobId = value => /^[a-f0-9]{32}$/.test(value || '')
export const projectRoot = projectId => {
  if (!validProjectId(projectId)) throw new Error('项目 ID 无效')
  return join(requiredConfig('ELYSIUM_STATE_ROOT'), 'projects', projectId)
}
export const projectJobRoot = (projectId, jobId) => {
  if (!validJobId(jobId)) throw new Error('任务 ID 无效')
  return join(projectRoot(projectId), 'jobs', jobId)
}

export async function findJobRoot(jobId) {
  if (!validJobId(jobId)) return null
  const uploaded = join(requiredConfig('ELYSIUM_STATE_ROOT'), 'uploads', jobId)
  try { await access(join(uploaded, 'status.json')); return { directory: uploaded } }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const projects = join(requiredConfig('ELYSIUM_STATE_ROOT'), 'projects')
  const entries = await readdir(projects, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
  for (const entry of entries) {
    if (!entry.isDirectory() || !validProjectId(entry.name)) continue
    const directory = projectJobRoot(entry.name, jobId)
    try { await access(directory); return { directory, projectId: entry.name } }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  return null
}
