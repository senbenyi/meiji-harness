import { assetStore, guidanceText } from './library.js'
import { readFile } from 'node:fs/promises'

const stages = new Set(['outline', 'shots', 'seconds', 'storyboard', 'film'])
export const skillStages = { 'skill-juqing-outline-generate': 'outline', 'skill-jingtou-jingtoubiao-table-generate': 'shots', 'skill-jingtou-jingtoubiao-shot-review': 'shots', 'skill-jingtou-meimiao-seconds-generate': 'seconds', 'skill-jingtou-wenben-storyboard-generate': 'storyboard', 'skill-chengpian-video-generate': 'film' }

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

export function customSkillPatch(project, stage, content, assets) {
  if (!stages.has(stage) || typeof content !== 'string' || content.length > 20000) throw Object.assign(new Error('自定义 skill 阶段无效或内容超过 20000 字'), { status: 400 })
  const customSkills = { ...project.customSkills }
  if (content.trim()) customSkills[stage] = content.trim()
  else delete customSkills[stage]
  if (assets === undefined) return { customSkills }
  const guidanceAssets = { ...project.guidanceAssets }
  if (assets.length) guidanceAssets[stage] = assets
  else delete guidanceAssets[stage]
  const patch = { customSkills, guidanceAssets }
  // 成片参考须先编入文本分镜并审核；保留旧产物，交给现有一键成片流程更新。
  if (stage === 'film' && JSON.stringify(project.guidanceAssets?.film || []) !== JSON.stringify(assets) && project.shots) {
    patch.shots = structuredClone(project.shots)
    for (const shot of patch.shots.items) for (const kind of ['storyboard', 'pencil', 'video', 'tailFrame']) {
      const target = shot[kind]
      if (!target?.content) continue
      target.stale = true
      target.check = { ...target.check, passed: false, failures: ['成片指导素材已更新，需重新编排文本分镜并生成成片'] }
    }
    if (project.assembly?.content) patch.assembly = { ...project.assembly, stale: true }
  }
  return patch
}

export function skillSupplement(project, skill) {
  const content = project?.customSkills?.[skillStages[skill]]
  return content ? `\n\n本阶段自定义 skill（补充内容要求，不改变输出结构、素材引用协议和项目语言配置）：\n${content}` : ''
}
