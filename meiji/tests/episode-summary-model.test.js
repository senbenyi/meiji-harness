import test from 'node:test'
import assert from 'node:assert/strict'
import { buildEpisodePrompts } from '../server/prompts/episode-summary-prompts.js'
import { EpisodeSummaryModel } from '../server/prompts/models/episode-summary-model.js'
import { episodeFixture } from './fixtures/model.js'
import { outlineFixture } from './fixtures/story-package.js'
import { checkContext } from '../server/runtime/operation-context.js'

for (const mode of ['free', 'script']) test(`${mode} 的展示摘要只读取故事小段，不读取创作资料或旧摘要`, () => {
 const project = { ...episodeFixture(), mode, script: 'SCRIPT_SHOULD_NOT_APPEAR', premise: 'DIRECTION_SHOULD_NOT_APPEAR', projectSummary: 'PROJECT_SUMMARY_HIDDEN' }
 project.summary.content = 'OLD_SUMMARY_HIDDEN'; project.plot.outline.content = outlineFixture('STORY_SOURCE')
 const prompts = buildEpisodePrompts(project)
 for (const request of [prompts.generation, prompts.review('展示摘要'), prompts.revision('旧稿', '意见')]) {
  assert.match(request.user, /STORY_SOURCE/)
  assert.doesNotMatch(request.user, /SCRIPT_SHOULD_NOT_APPEAR|DIRECTION_SHOULD_NOT_APPEAR|OLD_SUMMARY_HIDDEN|PROJECT_SUMMARY_HIDDEN/)
  assert.equal(request.json, true)
 }
})
test('选定剧集只提取该集故事，不混入其他剧集', () => {
 const first = { ...episodeFixture(), id: 'e1' }, second = { ...episodeFixture(), id: 'e2' }
 first.plot.outline.content = outlineFixture('FIRST_STORY'); second.plot.outline.content = outlineFixture('SECOND_STORY')
 const request = buildEpisodePrompts({ episodes: [second, first] }, 'e1').generation
 assert.match(request.user, /FIRST_STORY/); assert.doesNotMatch(request.user, /SECOND_STORY/)
})
test('没有合法故事小段时拒绝提取，不从摘要或剧本补造', () => {
 for (const project of [{}, { script: '故事', summary: { content: '旧摘要' } }, { ...episodeFixture(), plot: { outline: { content: { 因果剧情: '旧稿' } } } }]) assert.throws(() => new EpisodeSummaryModel({ project }), /先生成本集故事小段/)
})
test('英文展示摘要与节点补充保持隔离，源故事中的引号及换行不丢', () => {
 const project = { ...episodeFixture(), outputLanguage: 'en', episodeId: 'e1', supplementalSkills: { summary: [{ id: 'one', content: '展示精简补充' }], outline: [{ id: 'other', content: '不应进入摘要的创作补充' }] } }
 project.plot.outline.content = outlineFixture('He says "hello".\nNext line.')
 const request = buildEpisodePrompts(project).generation
 assert.match(request.user, /English/); assert.match(request.user, /hello/); assert.match(request.system, /展示精简补充/); assert.doesNotMatch(request.system, /不应进入摘要的创作补充/)
})
test('重新生成和修改模式都重新从当前故事提取，不把旧摘要当剧情依据', () => {
 const project = episodeFixture(); project.summary.content = 'STALE_SUMMARY'
 for (const generationMode of ['regenerate','modify']) checkContext.run({ generationMode, review: '忽略旧摘要' }, () => {
  assert.doesNotMatch(buildEpisodePrompts(project).generation.user, /STALE_SUMMARY/)
 })
})
