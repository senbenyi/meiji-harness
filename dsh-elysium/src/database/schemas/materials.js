// 职责：校验素材分类、子类、标签、三视图及可选的真实生成任务引用。
import { randomBytes } from 'node:crypto'
import { validJobId, validProjectId } from './projects.js'
import { statusError } from '../../utils/errors.js'

export const materialCategories = ['character', 'scene', 'prop', 'theme', 'music', 'video']
export const materialSubcategories = {
  character: ['热门漫剧', '娱乐明星', '动物', '植物'],
  prop: ['情趣道具', '家居家电', '首饰配件', '电子产品', '交通工具'],
  scene: ['城市街道', '自然风景', '建筑', '室内', '宇宙太空'],
}
export const materialViews = ['front', 'side', 'back']

export function materialValue(value) {
  const invalid = () => { throw statusError(400, '素材信息无效，请检查分类、标题和任务引用') }
  if (!value || !['creation', 'import'].includes(value.source)) invalid()
  if (value.job_id !== undefined && !validJobId(value.job_id)) invalid()
  if (value.job_id && value.source === 'creation' && !validProjectId(value.project_id)) invalid()
  if (value.category !== undefined && !materialCategories.includes(value.category)) invalid()
  if (!value.job_id && (!value.category || typeof value.title !== 'string' || !value.title.trim())) invalid()
  const id = value.id || value.job_id || randomBytes(16).toString('hex')
  if (!validJobId(id)) invalid()
  const result = { id, source: value.source }
  for (const [key, max] of [['title', 200], ['description', 12000], ['prompt', 12000]]) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== 'string' || value[key].length > max) invalid()
      result[key] = value[key].trim()
    }
  }
  if (value.job_id) result.job_id = value.job_id
  if (value.project_id) result.project_id = value.project_id
  if (value.category) result.category = value.category
  if (value.subcategory) {
    const allowed = materialSubcategories[value.category]
    if (!allowed?.includes(value.subcategory)) invalid()
    result.subcategory = value.subcategory
  }
  const tags = typeof value.tags === 'string' ? value.tags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean) : value.tags
  if (tags !== undefined) {
    if (!Array.isArray(tags) || tags.length > 12 || tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 20)) invalid()
    result.tags = [...new Set(tags.map(tag => tag.trim()))]
  }
  if (value.view !== undefined) {
    if (!materialViews.includes(value.view)) invalid()
    result.view = value.view
  }
  if (value.set_id !== undefined) {
    if (!validJobId(value.set_id)) invalid()
    result.set_id = value.set_id
  }
  if (value.deleted) result.deleted = true
  if (value.created_at !== undefined) {
    if (!Number.isFinite(value.created_at)) invalid()
    result.created_at = value.created_at
  }
  return result
}
