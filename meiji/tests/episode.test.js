import test from 'node:test'
import assert from 'node:assert/strict'
import { blankEpisode, addEpisode, editEpisode, materialize } from '../shared/episode-rules.js'
import { canGenerate, gateOf } from '../shared/generation-gates.js'
import { setupModel, episodeFixture } from './fixtures/model.js'
import { buildStoryPrompts } from '../server/prompts/story-prompts.js'
import { outlineFixture } from './fixtures/story-package.js'

test('新增剧集无需摘要，保存时长与本集要求，从大纲开始', () => {
 const episode=blankEpisode({durationSeconds:38,requirements:'先调查码头'})
 assert.equal(episode.summary.content,'');assert.equal(episode.durationSeconds,38);assert.equal(episode.storyRequirements,'先调查码头');assert.equal(episode.stage,'outline')
 for(const mode of ['free','script']) {
  const project={...episode,mode,premise:'找旧友',script:'旅人寻找旧友'}
  assert.equal(canGenerate(project,'outline'),true);assert.equal(gateOf(project),'outline')
 }
})
test('无剧本或方向时不能创作，摘要不能代替来源', () => {
 const project={...blankEpisode({durationSeconds:30}),summary:{content:'任意旧摘要',check:{passed:true}}}
 for(const mode of ['free','script'])assert.equal(canGenerate({...project,mode},'outline'),false)
})
test('后集使用前集故事原文承接，不读取压缩摘要', async t => {
 const {store,id}=await setupModel(t),root=await store.read(id),first=root.episodes[0]
 first.plot.outline.content=outlineFixture('前集完整状态 PREVIOUS_DETAIL');first.summary.content='PREVIOUS_SUMMARY_HIDDEN'
 const patch=addEpisode(root,{durationSeconds:30});const next={...root,...patch},work=materialize(next,patch.episodes[0].id)
 const prompt=buildStoryPrompts(work).generation
 assert.match(prompt.user,/PREVIOUS_DETAIL/);assert.doesNotMatch(prompt.user,/PREVIOUS_SUMMARY_HIDDEN/)
})
test('编辑剧集时长不允许通过摘要改写剧情，展示摘要不由用户保存', async t => {
 const {store,id}=await setupModel(t),root=await store.read(id),episode=root.episodes[0]
 const patch=editEpisode(root,episode.id,{durationSeconds:episode.durationSeconds,summary:'不得覆盖',requirements:'保留结尾'})
 assert.deepEqual(patch.episodes[0].plot.outline,episode.plot.outline)
 assert.equal(patch.episodes[0].summary.content,episode.summary.content)
 assert.equal(patch.episodes[0].storyRequirements,'保留结尾')
})
