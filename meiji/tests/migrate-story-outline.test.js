import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { projectStore } from '../server/data/project-store.js'
import { writeProjectFile, readProjectFile, indexFile, episodesDir } from '../server/data/project-files.js'
import { blankEpisode } from '../shared/episode-rules.js'
import { outlineFields, outlineText } from '../shared/story-outline.js'
import { outlineFixture } from './fixtures/story-package.js'
import { convertOutline, migrateStoryOutline } from '../scripts/migrate-story-outline.js'

async function oldProject(t, content) {
  const home = await mkdtemp('/tmp/meiji-outline-migration-');t.after(() => rm(home, { recursive: true, force: true }))
  const store = projectStore(home), project = await store.create({ mode: 'free', premise: '人的创作方向', title: '迁移测试', summary: '项目摘要' })
  project.episodes = [blankEpisode({ summary: '本集摘要', durationSeconds: 38 })]
  project.episodes[0].plot.outline.content = content
  await writeProjectFile(home, project)
  return { home, project, store }
}

test('旧中文/英文标题转换为固定中文字段，正文换行无损', () => {
  const outline = outlineFixture('英文 "引号"\n第二行'), text = outlineText(outline)
  assert.deepEqual(convertOutline(text), outline)
  const titles = ['Motivation', 'World Rules', 'Causal Plot', 'Emotional Thread', 'Dialogue Beats', 'Ending State', 'Final Image']
  assert.deepEqual(convertOutline(titles.map((title, i) => `[${title}]\n${outline[outlineFields[i]]}`).join('\n\n')), outline)
})

test('迁移先备份索引和剧集，读回正文、意见、ID不变，再次执行不修改', async t => {
  const outline = outlineFixture('第一行 "引号"\n第二行'), e = await oldProject(t, outlineText(outline))
  e.project.episodes[0].plot.outline.review.text = '尚未提交的意见'
  await writeProjectFile(e.home, e.project)
  const original = await readFile(indexFile(e.home, e.project.id), 'utf8'), result = await migrateStoryOutline(e.home)
  assert.equal(result.migrated, 1);assert.deepEqual(result.incomplete, [])
  assert.equal(await readFile(join(result.backup, e.project.id, 'index.json'), 'utf8'), original)
  const index = JSON.parse(original), backupEpisode = JSON.parse(await readFile(join(result.backup, e.project.id, 'episodes', index.episodes[0].file), 'utf8'))
  assert.equal(backupEpisode.plot.outline.content, outlineText(outline))
  const saved = await e.store.read(e.project.id)
  assert.deepEqual(saved, { ...e.project, episodes: [{ ...e.project.episodes[0], plot: { ...e.project.episodes[0].plot, outline: { ...e.project.episodes[0].plot.outline, content: outline } } }] })
  assert.deepEqual(await migrateStoryOutline(e.home), { migrated: 0 })
})

test('无标题旧稿保留正文并标记未通过，旧字符串运行时明确要求迁移', async t => {
  const e = await oldProject(t, '原稿不能丢失\n含 "引号" 的第二行')
  await assert.rejects(e.store.read(e.project.id), error => error.code === 'OLD_STORY_OUTLINE')
  const result = await migrateStoryOutline(e.home), target = (await e.store.read(e.project.id)).episodes[0].plot.outline
  assert.equal(result.incomplete.length, 1);assert.equal(target.content['因果剧情'], '原稿不能丢失\n含 "引号" 的第二行')
  assert.equal(target.check.passed, false);assert.equal(target.status, 'failed')
})

test('运行任务阻止迁移，预检失败不更改任何项目', async t => {
  const e = await oldProject(t, outlineText(outlineFixture()))
  e.project.episodes[0].activity = 'outline';await writeProjectFile(e.home, e.project)
  const original = await readFile(indexFile(e.home, e.project.id), 'utf8')
  await assert.rejects(migrateStoryOutline(e.home), /仍有任务运行/)
  assert.equal(await readFile(indexFile(e.home, e.project.id), 'utf8'), original)
  assert.equal((await readProjectFile(e.home, e.project.id)).episodes[0].plot.outline.content, e.project.episodes[0].plot.outline.content)
})

test('写入失败还原备份索引与剧集', async t => {
  const e = await oldProject(t, outlineText(outlineFixture())), index = JSON.parse(await readFile(indexFile(e.home, e.project.id), 'utf8'))
  const path = join(episodesDir(e.home, e.project.id), index.episodes[0].file)
  const episode = JSON.parse(await readFile(path, 'utf8'));episode.id = 'invalid/id'
  const original = JSON.stringify(episode);await writeFile(path, original)
  const originalIndex = await readFile(indexFile(e.home, e.project.id), 'utf8')
  await assert.rejects(migrateStoryOutline(e.home), /已还原项目.*剧集 ID 无效/)
  assert.equal(await readFile(indexFile(e.home, e.project.id), 'utf8'), originalIndex)
  assert.equal(await readFile(path, 'utf8'), original)
})
