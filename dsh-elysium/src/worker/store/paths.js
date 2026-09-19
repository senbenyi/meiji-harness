// 职责：校验任务身份，并定位全局执行记录或导入记录。
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { jobsRoot, projectsRoot, uploadsRoot } from '../../database/paths.js'

export const FREE_PROJECT_ID = '00000000'
export const validProjectId = value => /^(?:[a-f0-9]{8}|\d{17})$/.test(value || '')
export const validJobId = value => /^[a-f0-9]{32}$/.test(value || '')
export const projectRoot = projectId => {
  if (!validProjectId(projectId)) throw new Error('项目 ID 无效')
  return join(projectsRoot(), projectId)
}
export const jobRoot = jobId => {
  if (!validJobId(jobId)) throw new Error('任务 ID 无效')
  return join(jobsRoot(), jobId)
}

export async function findJobRoot(jobId) {
  if (!validJobId(jobId)) return null
  const uploaded = join(uploadsRoot(), jobId)
  try { await access(join(uploaded, 'status.json')); return { directory: uploaded } }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const directory = jobRoot(jobId)
  try { await access(directory); return { directory } }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  return null
}
