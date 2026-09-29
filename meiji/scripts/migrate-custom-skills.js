// 补充 skill 与指导素材迁移：按集保存（episode.customSkills / episode.guidanceAssets）→ 按剧保存（项目索引 skills）。
// 用法（先停止 Harness）：node meiji/scripts/migrate-custom-skills.js <DSH_HOME>
//   各集的补充 skill 合并为本剧补充（阶段技能的「生成」字段），每段标注来源集，内容相同的集合并标注；
//   阶段对应：outline → outline；shots → shots 与 shot-revise；seconds → seconds；storyboard → storyboard；film → video。
//   各集选择的指导素材按阶段取并集（同一素材只保留一份）；指导技能启用状态写为默认值。
// 没有旧字段的项目跳过，可重复执行。迁移前把项目索引与剧集文件备份到 <DSH_HOME>/backups/custom-skills-<时间>/<项目>/，
// 写入后读回核对：各集原有补充内容都在本剧补充中、剧集不再含旧字段；不一致则还原该项目并中止。
import { cp, mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { episodeSnapshot, episodesDir, indexFile, projectIds, readProjectFile, writeProjectFile, LAYOUT } from '../server/data/project-files.js'
import { projectSkills } from '../server/data/skill-store.js'

export const stageSkills = { outline: ['outline'], shots: ['shots', 'shot-revise'], seconds: ['seconds'], storyboard: ['storyboard'], film: ['video'] }
const oldFields = episode => Object.hasOwn(episode, 'customSkills') || Object.hasOwn(episode, 'guidanceAssets')

// 把各集的补充与素材合并到项目 skills，并从剧集中删除旧字段。返回新的项目对象（不修改入参）。
export function foldEpisodeSkills(project) {
  const next = structuredClone(project)
  if (!next.episodes?.some(oldFields)) return next
  const skills = projectSkills(next.skills)
  const ordered = [...next.episodes].reverse()
  const numberOf = episode => ordered.indexOf(episode) + 1
  const texts = new Map()
  for (const episode of ordered) {
    for (const [stage, content] of Object.entries(episode.customSkills || {})) {
      const text = String(content || '').trim()
      if (!text || !stageSkills[stage]) continue
      const key = `${stage}\n${text}`
      if (!texts.has(key)) texts.set(key, { stage, text, episodes: [] })
      texts.get(key).episodes.push(numberOf(episode))
    }
    for (const [stage, assets] of Object.entries(episode.guidanceAssets || {})) {
      const current = skills.assets[stage] || []
      const known = new Set(current.map(asset => asset.id))
      skills.assets[stage] = [...current, ...(assets || []).filter(asset => asset?.id && !known.has(asset.id) && known.add(asset.id))]
      if (!skills.assets[stage].length) delete skills.assets[stage]
    }
  }
  for (const { stage, text, episodes } of texts.values()) {
    const labelled = `（来自第 ${episodes.join('、')} 集）\n${text}`
    for (const id of stageSkills[stage]) {
      const current = skills.additions[id]?.generate
      skills.additions[id] = { ...skills.additions[id], generate: current ? `${current}\n\n${labelled}` : labelled }
    }
  }
  for (const episode of next.episodes) { delete episode.customSkills; delete episode.guidanceAssets }
  next.skills = skills
  return next
}

// 迁移后核对：原有补充都能在对应技能的本剧补充中找到，素材都在，剧集没有旧字段。
function verify(before, after) {
  if (after.episodes.some(oldFields)) throw new Error('剧集仍含旧字段')
  for (const episode of before.episodes) {
    for (const [stage, content] of Object.entries(episode.customSkills || {})) {
      const text = String(content || '').trim()
      if (text && stageSkills[stage] && stageSkills[stage].some(id => !after.skills.additions[id]?.generate?.includes(text))) throw new Error(`${stage} 的补充内容未迁移完整`)
    }
    for (const [stage, assets] of Object.entries(episode.guidanceAssets || {})) {
      const ids = new Set((after.skills.assets[stage] || []).map(asset => asset.id))
      if ((assets || []).some(asset => asset?.id && !ids.has(asset.id))) throw new Error(`${stage} 的指导素材未迁移完整`)
    }
  }
}

export async function migrateCustomSkills(home) {
  const pending = []
  for (const id of await projectIds(home)) {
    const index = JSON.parse(await readFile(indexFile(home, id), 'utf8'))
    if (index.layout !== LAYOUT) continue
    const project = await readProjectFile(home, id)
    if (project.episodes.some(oldFields)) pending.push(project)
  }
  if (!pending.length) return { migrated: 0 }
  const backup = join(home, 'backups', `custom-skills-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  const projects = []
  for (const project of pending) {
    const target = join(backup, project.id)
    await mkdir(target, { recursive: true })
    await cp(indexFile(home, project.id), join(target, project.id + '.json'))
    await cp(episodesDir(home, project.id), join(target, 'episodes'), { recursive: true })
    const next = foldEpisodeSkills(project)
    try {
      await writeProjectFile(home, next, episodeSnapshot(project))
      verify(project, await readProjectFile(home, project.id))
    } catch (error) {
      await cp(join(target, 'episodes'), episodesDir(home, project.id), { recursive: true, force: true })
      await cp(join(target, project.id + '.json'), indexFile(home, project.id), { force: true })
      throw new Error(`${project.id} 迁移失败，已还原该项目（备份：${target}）：${error.message}`)
    }
    projects.push({ id: project.id, additions: Object.keys(next.skills.additions), assets: Object.fromEntries(Object.entries(next.skills.assets).map(([stage, list]) => [stage, list.length])) })
  }
  return { migrated: projects.length, backup, projects }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('用法：node meiji/scripts/migrate-custom-skills.js <DSH_HOME>')
  console.log(JSON.stringify(await migrateCustomSkills(resolve(process.argv[2])), null, 2))
}
