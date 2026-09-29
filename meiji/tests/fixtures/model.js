import { mkdtemp, rm } from 'node:fs/promises'
import { projectStore } from '../../server/data/projects.js'
import { blankEpisode, materialize } from '../../server/data/episodes.js'
import { node, cardModel, shotModel, setContent } from '../../shared/drama-model.js'
export function episodeFixture() {
  const e = blankEpisode({ summary: '旅人进入庭院', durationSeconds: 10 })
  e.title = '测试剧'
  setContent(e.plot.outline, '旅人进入庭院（10秒）', { passed: true, failures: [] })
  e.plot.characters.items = [cardModel({ id: 'C01', name: '旅人', type: 'role', look: '国籍：中国 姓名：旅人 身份：探险者 性别：男性 年代：古代 年龄：三十岁 服装：长衣 身高：一米八 体型：结实 面相：方脸', clothes: [], props: [], hairstyles: [] })]
  e.plot.scenes.items = [cardModel({ id: 'E01', name: '庭院', type: 'scene', look: '开阔庭院及远处山脉，完整门墙与通道', space: '南门北墙' })]
  for (const key of ['characters', 'scenes']) { e.plot[key].status = 'passed'; e.plot[key].check.passed = true }
  e.shots.items = ['S01', 'S02'].map(id => {
    const shot = shotModel({ id, duration: 5, text: '旅人朝北进入庭院', cast: ['旅人'], scene: '庭院', format: 'text' })
    shot.status = 'passed'; shot.check.passed = true
    setContent(shot.seconds, '0–5s：旅人朝北行走，摄影机位于身后。', { passed: true, failures: [] })
    setContent(shot.storyboard, { format: 'text', duration: 5, title: id, video: 'text', characters: ['旅人'], scene: '庭院', prompt: { text: 'summary: 旅人朝北进入庭院\ndetailed_description: 摄影机位于旅人身后\noverall_soundscape: 风声\nnon_diegetic_music: N/A' } }, { passed: true, failures: [] })
    return shot
  })
  e.shots.status = 'passed'; e.shots.check.passed = true
  return e
}
// 任务测试用的临时数据目录（任务管理入队时写入任务记录）。
export async function tempHome(t) {
  const home = await mkdtemp('/tmp/meiji-tasks-test-'); t.after(() => rm(home, { recursive: true, force: true }))
  return home
}
export async function setupModel(t) {
  const home = await mkdtemp('/tmp/meiji-model-test-'); t.after(() => rm(home, { recursive: true, force: true }))
  const store = projectStore(home), project = await store.create({ title: '测试剧', summary: '旅人的冒险' }), episode = episodeFixture()
  await store.save(project.id, { episodes: [episode] })
  return { home, store, id: project.id, episodeId: episode.id, episode,
    op: (action, fields = {}) => ({ action, projectId: project.id, episodeId: episode.id, ...fields }),
    read: async () => materialize(await store.read(project.id), episode.id) }
}
