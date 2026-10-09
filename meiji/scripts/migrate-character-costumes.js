// 停止服务后执行；备份原始文件，补齐服装集合并保持旧默认形象不变。
import { cp, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { characterFieldValues } from '../shared/character-facts.js'
import { normalizeCostumes, mergeCostumes, wardrobeFields } from '../shared/character-costumes.js'
import { indexFile, episodesDir, projectIds, readProjectFile, writeProjectFile, episodeSnapshot } from '../server/data/project-files.js'

export function migrateCostumes(project) {
  const next = structuredClone(project)
  const fill = fields => {
    if (Array.isArray(fields.costumes)) { Object.assign(fields, wardrobeFields(fields)); return }
    const text = characterFieldValues(fields).costume
    fields.costumes = normalizeCostumes(text && !/未说明|未设定|未知/.test(text) ? [{ id: '', name: '默认服装', description: text }] : [])
    Object.assign(fields, wardrobeFields(fields))
  }
  for (const entry of next.library?.characters || []) for (const variant of entry.variants) fill(variant.fields)
  for (const episode of next.episodes) for (const card of episode.plot?.characters?.items || []) {
    const entry = next.library?.characters.find(item => item.id === card.ref?.libraryId)
    const fields = entry?.variants.find(item => item.id === entry.defaultVariantId)?.fields
    fill(card)
    if (fields) Object.assign(fields, wardrobeFields({ costumes: mergeCostumes(fields.costumes, card.costumes) }, fields))
  }
  for (const episode of next.episodes) for (const card of episode.plot?.characters?.items || []) {
    const entry = next.library?.characters.find(item => item.id === card.ref?.libraryId)
    const fields = entry?.variants.find(item => item.id === entry.defaultVariantId)?.fields
    if (fields) { card.costumes = structuredClone(fields.costumes); card.defaultCostumeId = fields.defaultCostumeId }
  }
  return next
}

export async function migrateCharacterCostumes(home) {
  const changes = []
  for (const id of await projectIds(home)) {
    const original = await readProjectFile(home, id), next = migrateCostumes(original)
    if (JSON.stringify(original) !== JSON.stringify(next)) changes.push({ original, next })
  }
  if (!changes.length) return { migrated: 0 }
  const backup = join(home, 'backups', `character-costumes-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  for (const { original } of changes) {
    const folder = join(backup, original.id)
    await mkdir(folder, { recursive: true })
    await cp(indexFile(home, original.id), join(folder, 'index.json'))
    await cp(episodesDir(home, original.id), join(folder, 'episodes'), { recursive: true })
  }
  try {
    for (const { original, next } of changes) {
      await writeProjectFile(home, next, episodeSnapshot(original))
      if (JSON.stringify(await readProjectFile(home, next.id)) !== JSON.stringify(next)) throw new Error('读回内容不一致')
    }
  } catch (error) {
    for (const { original } of changes) {
      const folder = join(backup, original.id)
      await cp(join(folder, 'episodes'), episodesDir(home, original.id), { recursive: true, force: true })
      await cp(join(folder, 'index.json'), indexFile(home, original.id), { force: true })
    }
    throw new Error(`服装迁移失败，已还原：${error.message}`)
  }
  return { migrated: changes.length, backup }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('用法：node meiji/scripts/migrate-character-costumes.js <DSH_HOME>')
  console.log(JSON.stringify(await migrateCharacterCostumes(resolve(process.argv[2])), null, 2))
}
