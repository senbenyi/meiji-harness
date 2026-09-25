import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectStore } from '../server/data/projects.js'
import { addEpisode, editEpisode, materialize, normalizeProject, overviewPatch, scopeProjects } from '../server/data/episodes.js'

test('a project without episodes opens its existing work as the first episode', () => {
  const project = normalizeProject({
    id: '11111111-1111-4111-8111-111111111111',
    createdAt: '2026-09-24T00:00:00.000Z',
    title: '桃源',
    summary: '开场',
    durationSeconds: 300,
    aspectRatio: '768x1344',
    stage: 'characters',
    brief: { logline: '一句话', style: '风格' },
    outline: '大纲',
    characters: { items: [{ id: 'C01' }] },
    films: {},
  })
  assert.equal(project.episodes.length, 1)
  assert.equal(project.episodes[0].id, project.id)
  assert.equal(project.episodes[0].stage, 'characters')
  const work = materialize(project, project.id)
  assert.equal(work.durationSeconds, 300)
  assert.equal(work.summary, '开场')
  assert.equal(work.characters.items[0].id, 'C01')
})

test('new episodes are stored newest first and editing the plot resets that episode', () => {
  const project = { id: 'p', summary: '总故事', episodes: [], title: '标题', aspectRatio: '768x1344' }
  const first = addEpisode(project, { durationSeconds: 60, summary: '第一集进城' })
  const second = addEpisode({ ...project, ...first }, { durationSeconds: 90, summary: '第二集回头' })
  assert.equal(second.episodes[0].summary, '第二集回头')
  assert.equal(second.episodes[1].summary, '第一集进城')
  const started = {
    ...project,
    episodes: second.episodes.map(episode => episode.summary === '第二集回头'
      ? { ...episode, stage: 'outline', outline: '已写', brief: { logline: '一句', style: '风格' } }
      : episode),
  }
  const edited = editEpisode(started, second.episodes[0].id, { durationSeconds: 90, summary: '第二集改口' })
  const episode = edited.episodes.find(item => item.id === second.episodes[0].id)
  assert.equal(episode.summary, '第二集改口')
  assert.equal(episode.stage, 'brief')
  assert.equal(episode.outline, null)
  assert.equal(edited.episodes[1].summary, '第一集进城')
})

test('episode production writes stay inside that episode', async () => {
  const home = await mkdtemp(join(tmpdir(), 'meiji-episode-'))
  try {
    const store = projectStore(home)
    const created = await store.create({ title: '测', summary: '总故事' })
    const added = await store.save(created.id, addEpisode(created, { durationSeconds: 30, summary: '这一集推门' }))
    const episodeId = added.episodes[0].id
    const scoped = scopeProjects(store, episodeId)
    const saved = await scoped.writeStep(created.id, 'brief', { brief: { logline: '推门', style: '夜' } })
    assert.equal(saved.episodeId, episodeId)
    assert.equal(saved.brief.logline, '推门')
    const stored = await store.read(created.id)
    assert.equal(stored.summary, '总故事')
    assert.equal(stored.episodes[0].brief.logline, '推门')
    assert.equal(stored.brief, null)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('reading a legacy project file wraps it without dropping the file', async () => {
  const home = await mkdtemp(join(tmpdir(), 'meiji-legacy-'))
  try {
    const id = '22222222-2222-4222-8222-222222222222'
    const root = join(home, 'storages', 'meiji', 'projects')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, id + '.json'), JSON.stringify({
      id,
      createdAt: '2026-09-24T00:00:00.000Z',
      title: '旧项目',
      summary: '旧摘要',
      durationSeconds: 12,
      stage: 'shots',
      shots: { items: [{ id: 'S01' }] },
    }))
    const project = await projectStore(home).read(id)
    assert.equal(project.episodes.length, 1)
    assert.equal(project.episodes[0].stage, 'shots')
    assert.equal(project.episodes[0].shots.items[0].id, 'S01')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('editing the project keeps the script and updates title, style, aspect, and summary', () => {
  const project = { title: '旧标题', summary: '旧摘要', script: '完整剧本', aspectRatio: '1344x768', style: '写实' }
  const patch = overviewPatch(project, { title: '新标题', style: ' 搞笑 ', summary: '新摘要', aspectRatio: '768x1344' })
  assert.deepEqual(patch, { title: '新标题', summary: '新摘要', script: '完整剧本', aspectRatio: '768x1344', style: '搞笑' })
  assert.throws(() => overviewPatch(project, { title: '新标题', style: '风'.repeat(121), summary: '新摘要' }), /风格需为 1–120 字/)
  assert.throws(() => overviewPatch(project, { title: '新标题', summary: '新摘要', aspectRatio: '3:4' }), /画幅需为 1344x768 或 768x1344/)
})
