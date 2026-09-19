// 职责：校验并持久化全局素材库索引，不移动或复制媒体文件。
import { join } from 'node:path'
import { poolsRoot } from '../paths.js'
import { readJson, saveJson } from '../json.js'
import { materialValue } from '../schemas/materials.js'

const path = () => join(poolsRoot(), 'materials.json')
let operations = Promise.resolve()

function enqueue(action) {
  const operation = operations.then(action)
  operations = operation.catch(() => {})
  return operation
}

async function load() {
  const value = await readJson(path())
  if (value === null) return null
  if (![1, 2].includes(value.version) || !Array.isArray(value.materials)) throw new Error('素材库格式无效')
  const materials = value.materials.map(materialValue)
  if (new Set(materials.map(item => item.id)).size !== materials.length) throw new Error('素材库存在重复素材')
  return materials
}

const write = materials => saveJson(path(), { version: 2, materials })

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
    const index = materials.findIndex(item => item.id === material.id || material.job_id && item.job_id === material.job_id)
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
    const index = materials.findIndex(item => item.id === jobId || item.job_id === jobId)
    if (index < 0) throw Object.assign(new Error('素材不在素材库中'), { status: 404 })
    if (!materials[index].deleted) {
      materials[index] = { ...materials[index], deleted: true }
      await write(materials)
    }
    return { deleted: true }
  })
}

// 仅允许编辑展示信息，生成任务引用由创建流程设置。
export function updateMaterial(id, patch) {
  return enqueue(async () => {
    const materials = await load() || []
    const index = materials.findIndex(item => item.id === id && !item.deleted)
    if (index < 0) throw Object.assign(new Error('素材不存在'), { status: 404 })
    const next = { ...materials[index] }
    for (const key of ['title', 'description', 'prompt', 'category', 'subcategory', 'tags', 'view', 'set_id']) {
      if (patch[key] !== undefined) next[key] = patch[key]
    }
    materials[index] = materialValue(next)
    await write(materials)
    return materials[index]
  })
}
