// 本剧的指导素材：按阶段选择（outline / shots / seconds / storyboard / film），存于项目 skills.assets。
// 素材内容在选择时从本地素材库读出并随项目保存，生成时按指导技能分组编入提示词（prompts/skill-prompts.js）。
import { assetStore, guidanceText } from './library.js'
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

// 保存某阶段选择的指导素材（项目级补丁）。成片素材先编入文本分镜并审核：更换后各集已有的文本分镜及下游标记待更新，
// 保留旧产物，交给现有一键成片流程更新。
export function assetsPatch(project, stage, assets) {
  if (!assetStages.includes(stage)) throw Object.assign(new Error('指导素材阶段无效'), { status: 400 })
  const skills = projectSkills(project.skills)
  const before = skills.assets[stage] || []
  if (assets.length) skills.assets[stage] = assets
  else delete skills.assets[stage]
  const patch = { skills }
  if (stage === 'film' && JSON.stringify(before) !== JSON.stringify(assets)) {
    patch.episodes = project.episodes.map(episode => {
      if (!episode.shots?.items?.length) return episode
      const next = { ...episode, shots: structuredClone(episode.shots) }
      for (const shot of next.shots.items) for (const kind of ['storyboard', 'pencil', 'video', 'tailFrame']) {
        const target = shot[kind]
        if (!target?.content) continue
        target.stale = true
        target.check = { ...target.check, passed: false, failures: ['成片指导素材已更新，需重新编排文本分镜并生成成片'] }
      }
      if (next.assembly?.content) next.assembly = { ...next.assembly, stale: true }
      return next
    })
  }
  return patch
}
