// 职责：校验并持久化全局素材库索引，不移动或复制媒体文件。
import { join } from 'node:path'
import { poolsRoot } from '../../utils/storage-paths.js'
import { readJson, saveJson } from '../jobs/store.js'
import { validJobId, validProjectId } from '../jobs/paths.js'

const path = () => join(poolsRoot(), 'materials.json')
let operations = Promise.resolve()

function enqueue(action) {
  const operation = operations.then(action)
  operations = operation.catch(() => {})
  return operation
}

function materialValue(value) {
  if (!value || !validJobId(value.job_id) || !['creation', 'import'].includes(value.source) ||
    value.source === 'creation' && !validProjectId(value.project_id)) throw new Error('素材库格式无效')
  return { job_id: value.job_id, source: value.source,
    ...(value.source === 'creation' ? { project_id: value.project_id } : {}), ...(value.deleted ? { deleted: true } : {}) }
}

async function load() {
  const value = await readJson(path())
  if (value === null) return null
  if (value.version !== 1 || !Array.isArray(value.materials)) throw new Error('素材库格式无效')
  const materials = value.materials.map(materialValue)
  if (new Set(materials.map(item => item.job_id)).size !== materials.length) throw new Error('素材库存在重复素材')
  return materials
}

const write = materials => saveJson(path(), { version: 1, materials })

export function syncMaterials(discovered) {
  return enqueue(async () => {
    let materials = await load()
    if (materials === null) {
      materials = discovered.map(materialValue)
      await write(materials)
      return materials
    }
    const known = new Set(materials.map(item => item.job_id))
    const additions = discovered.map(materialValue).filter(item => !known.has(item.job_id))
    if (additions.length) { materials = [...materials, ...additions]; await write(materials) }
    return materials
  })
}

export function addMaterial(value) {
  return enqueue(async () => {
    const material = materialValue(value), materials = await load() || []
    const index = materials.findIndex(item => item.job_id === material.job_id)
    if (index < 0) materials.push(material)
    else materials[index] = material
    await write(materials)
    return material
  })
}

export function removeMaterial(jobId) {
  return enqueue(async () => {
    const materials = await load()
    if (materials === null) throw new Error('素材库尚未建立')
    const index = materials.findIndex(item => item.job_id === jobId)
    if (index < 0) throw new Error('素材不在素材库中')
    if (!materials[index].deleted) {
      materials[index] = { ...materials[index], deleted: true }
      await write(materials)
    }
    return { deleted: true }
  })
}
