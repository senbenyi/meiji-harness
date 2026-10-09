import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { projectStore } from '../server/data/project-store.js'
import { writeProjectFile, readProjectFile, indexFile, episodesDir } from '../server/data/project-files.js'
import { blankEpisode } from '../shared/episode-rules.js'
import { outlineText, outlineFailures } from '../shared/story-outline.js'
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

test('七字段旧稿转换成故事小段，正文、引号与换行无损', () => {
  const old = { 主角动机: '见到旧友', 因果剧情: '1. 拿信\n2. 拆信', 对白节拍: '旅人：「是谁？」', 结尾状态: '左手拿信，右手提灯' }
  const result = convertOutline(old, 38)
  for (const body of Object.values(old)) assert.ok(result.map(part => part.正文).join('\n').includes(body))
  assert.equal(outlineFailures(result).length, 0)
  assert.deepEqual(convertOutline(result, 38), result)
  assert.deepEqual(convertOutline('1. 英文 "引号"\n第二行', 38), outlineFixture('英文 "引号"\n第二行', 'zh-CN', 38))
})

test('迁移先备份索引和剧集，读回正文、意见、ID不变，再次执行不修改', async t => {
  const outline = outlineFixture('第一行 "引号"\n第二行', 'zh-CN', 38), old = '1. 第一行 "引号"\n第二行', e = await oldProject(t, {故事小段: old})
  e.project.episodes[0].plot.outline.review.text = '尚未提交的意见'
  await writeProjectFile(e.home, e.project)
  const original = await readFile(indexFile(e.home, e.project.id), 'utf8'), result = await migrateStoryOutline(e.home)
  assert.equal(result.migrated, 1);assert.deepEqual(result.incomplete, [])
  assert.equal(await readFile(join(result.backup, e.project.id, 'index.json'), 'utf8'), original)
  const index = JSON.parse(original), backupEpisode = JSON.parse(await readFile(join(result.backup, e.project.id, 'episodes', index.episodes[0].file), 'utf8'))
  assert.deepEqual(backupEpisode.plot.outline.content, {故事小段: old})
  const saved = await e.store.read(e.project.id)
  assert.equal(saved.episodes[0].id, e.project.episodes[0].id)
  assert.deepEqual(saved.episodes[0].plot.outline.content, outline)
  assert.equal(saved.episodes[0].plot.outline.review.text, '尚未提交的意见')
  assert.equal(saved.episodes[0].plot.outline.check.passed, null)
  assert.match(saved.episodes[0].plot.outline.check.failures[0], /暂估/)
  assert.deepEqual(saved.episodes[0].shots, e.project.episodes[0].shots)
  assert.deepEqual(await migrateStoryOutline(e.home), { migrated: 0 })
})

test('无标题旧稿保留正文并转换为一个故事小段，旧字符串运行时明确要求迁移', async t => {
  const e = await oldProject(t, '原稿不能丢失\n含 "引号" 的第二行')
  await assert.rejects(e.store.read(e.project.id), error => error.code === 'OLD_STORY_OUTLINE')
  const result = await migrateStoryOutline(e.home), target = (await e.store.read(e.project.id)).episodes[0].plot.outline
  assert.equal(result.incomplete.length, 0);assert.equal(target.content[0].正文, '原稿不能丢失\n含 "引号" 的第二行')
  assert.equal(outlineFailures(target.content).length, 0)
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

test('编号旧稿逐段保留正文，整数预算合计等于剧集时长，空白旧稿不造内容', () => {
  const old = {故事小段:'1. 第一段说："别走"。\n保留第二行。\n\n2. 第二段完整结尾。'}
  const result = convertOutline(old, 300)
  assert.deepEqual(result.map(part => part.正文), ['第一段说："别走"。\n保留第二行。','第二段完整结尾。'])
  assert.equal(result.reduce((sum,part)=>sum+part.时长秒,0), 300)
  assert.deepEqual(outlineFailures(result,300), [])
  assert.equal(convertOutline({故事小段:''},300), null)
})
