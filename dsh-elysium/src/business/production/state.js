// 职责：持久化生产清单指纹、镜头回执与整体进度。
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { readJson, saveJson } from '../jobs/store.js'
import { projectsRoot } from '../../utils/storage-paths.js'

export const productionDirectory = (stateRoot, projectId) => join(projectsRoot(stateRoot), projectId, 'production')
export const shotPaths = (directory, shotId) => ({
  receipt: join(directory, 'shots', `${shotId}.receipt.json`),
  attempts: join(directory, 'shots', `${shotId}.attempts.json`),
  history: join(directory, 'shots', `${shotId}.history.json`),
  referenceGraph: join(directory, 'shots', `${shotId}.reference.api.json`),
  referenceSubmission: join(directory, 'shots', `${shotId}.reference.submission.json`),
})

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export async function initializeProduction(directory, manifest) {
  const saved = await readJson(join(directory, 'manifest.json'))
  if (saved && digest(saved) !== digest(manifest)) throw new Error(`${manifest.project_id}: 已开始执行，禁止修改清单后复用原状态`)
  if (!saved) await saveJson(join(directory, 'manifest.json'), manifest)
}

export const readAnchors = async directory => await readJson(join(directory, 'anchors.json')) || {}
export const saveAnchors = (directory, anchors) => saveJson(join(directory, 'anchors.json'), anchors)

export async function finishAttempt(path, attempts, status, now = () => new Date().toISOString()) {
  Object.assign(attempts.at(-1), { ended_at: now(), status })
  await saveJson(path, attempts)
}

export const saveProgress = (directory, value) => saveJson(join(directory, 'progress.json'), value)
