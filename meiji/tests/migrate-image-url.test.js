import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { setupModel } from './fixtures/model.js'
import { readProjectFile, writeProjectFile } from '../server/data/project-files.js'
import { assetStore } from '../server/data/asset-library-store.js'
import { projectStore } from '../server/data/project-store.js'
import { migrateImageUrl } from '../scripts/migrate-image-url.js'

const local = id => `/plugins/meiji/asset-file?category=characters&id=${id}`

test('gateway file addresses are removed; snapshots and tails point to local pictures', async t => {
  const e = await setupModel(t)
  const asset = await assetStore(e.home).import('characters', '旅人.png', Readable.from([Buffer.from('png')]), undefined, { source: 'import' })
  const project = await readProjectFile(e.home, e.id)
  const episode = project.episodes[0]
  const [person] = episode.plot.characters.items
  person.image.content = { localPath: local('a'), assetId: 'a', assetCategory: 'characters', imageUrl: 'https://gw.test/v1/files/file_a/content' }
  person.clothes = [{ id: 'C01-W01', name: '外套', localPath: '/plugins/meiji/w', imageUrl: 'https://gw.test/v1/files/file_w/content' }]
  const scene = episode.plot.scenes.items[0]
  scene.image.content = { imageUrl: 'https://gw.test/v1/files/file_s/content' }
  scene.image.status = 'passed'
  const [first, second] = episode.shots.items
  first.video.content = { status: 'ready', file: 'S01-x.mp4' }
  first.tailFrame.content = { sourceVideoFile: 'S01-x.mp4', localPath: '/films/S01-x-last.png', imageUrl: 'https://gw.test/tail', file: { id: 'file_t', url: 'https://gw.test/tail' } }
  second.storyboard.content.tailReference = { sourceShotId: 'S01', sourceVideoFile: 'S01-x.mp4', imageUrl: 'https://gw.test/tail' }
  second.storyboard.content.referenceSnapshot = [
    { id: person.id, url: 'https://gw.test/v1/files/file_a/content', kind: 'characters', assetId: 'a', localPath: local('a') },
    { id: 'C01-W01', ownerId: person.id, slot: 'clothes', url: 'https://gw.test/v1/files/file_w/content', kind: 'characters' },
    { url: 'https://gw.test/tail', kind: 'tailFrame', sourceShotId: 'S01', sourceVideoFile: 'S01-x.mp4' },
  ]
  await writeProjectFile(e.home, project)
  await assert.rejects(projectStore(e.home).read(e.id), { code: 'OLD_IMAGE_URL' })
  const metadataFile = join(e.home, 'storages', 'meiji', 'assets', 'characters', asset.id, 'metadata.json')
  const { writeFile } = await import('node:fs/promises')
  await writeFile(metadataFile, JSON.stringify({ ...asset, imageUrl: 'https://gw.test/asset' }))

  const result = await migrateImageUrl(e.home)
  assert.equal(result.migrated, 1)
  assert.equal(result.assets, 1)
  assert.deepEqual(result.projects[0].cleared, [`${episode.id}：${scene.id} ${scene.name}`])
  const migrated = (await projectStore(e.home).read(e.id)).episodes[0]
  assert.equal(JSON.stringify(migrated).includes('gw.test'), false)
  assert.deepEqual(migrated.plot.characters.items[0].image.content, { localPath: local('a'), assetId: 'a', assetCategory: 'characters' })
  assert.deepEqual(migrated.plot.characters.items[0].clothes, [{ id: 'C01-W01', name: '外套', localPath: '/plugins/meiji/w' }])
  assert.equal(migrated.plot.scenes.items[0].image.content, null)
  assert.deepEqual(migrated.shots.items[0].tailFrame.content, { sourceVideoFile: 'S01-x.mp4', localPath: '/films/S01-x-last.png' })
  assert.deepEqual(migrated.shots.items[1].storyboard.content.tailReference, { sourceShotId: 'S01', sourceVideoFile: 'S01-x.mp4' })
  assert.deepEqual(migrated.shots.items[1].storyboard.content.referenceSnapshot.map(ref => ref.url), [local('a'), '/plugins/meiji/w', 'tail-frame:S01-x.mp4'])
  assert.equal(migrated.shots.items[0].video.content.file, 'S01-x.mp4')
  assert.equal('imageUrl' in JSON.parse(await readFile(metadataFile, 'utf8')), false)
  const [backup] = await readdir(join(e.home, 'backups'))
  assert.deepEqual((await readdir(join(e.home, 'backups', backup))).sort(), ['assets', e.id].sort())
  // 可重复执行：已迁移的跳过
  assert.deepEqual(await migrateImageUrl(e.home), { migrated: 0 })
})
