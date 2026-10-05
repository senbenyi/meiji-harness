// 本剧的指导素材：按阶段选择（outline / shots / seconds / storyboard / film），存于项目 skills.assets。
// 素材内容在选择时从本地素材库读出并随项目保存，生成时按指导技能分组编入提示词（prompts/skill-prompts.js）。
import { assetStore, guidanceText } from './asset-library-store.js'
import { readFile } from 'node:fs/promises'
import { projectSkills } from './skill-store.js'

export const assetStages = ['outline', 'shots', 'seconds', 'storyboard', 'film']

export async function loadGuidanceAssets(home, ids) {
  if (!Array.isArray(ids) || ids.length > 20 || ids.some(id => typeof id !== 'string')) throw Object.assign(new Error('每阶段最多选择 20 个指导素材'), { status: 400 })
  const store = assetStore(home)
  const assets = await Promise.all([...new Set(ids)].map(async id => {
    try {
      const { metadata, path } = await store.file('guidance', id)
      return { id, name: metadata.originalName, guidanceType: metadata.guidanceType, content: guidanceText(await readFile(path)) }
    } catch (error) {
      if (error.code === 'ENOENT') throw Object.assign(new Error('指导素材不存在，请重新选择'), { status: 400 })
      throw error
    }
  }))
  if (assets.reduce((size, asset) => size + asset.content.length, 0) > 60000) throw Object.assign(new Error('所选指导素材合计不能超过 60000 字'), { status: 400 })
  return assets
}

// 指导素材仅影响之后的任务，不删除已有产物。
export function assetsPatch(project, stage, assets) {
  if (!assetStages.includes(stage)) throw Object.assign(new Error('指导素材阶段无效'), { status: 400 })
  const skills = projectSkills(project.skills)
  if (assets.length) skills.assets[stage] = assets
  else delete skills.assets[stage]
  return { skills }
}
