import { outlineFixture } from './fixtures/story-package.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { promptData } from './fixtures/prompt-data.js'
import { episodeFixture } from './fixtures/model.js'
import { buildStoryPrompts } from '../server/prompts/story-prompts.js'
import { buildEpisodePrompts } from '../server/prompts/episode-summary-prompts.js'
import { buildSecondsPrompts, buildSingleShotPrompts, buildTablePrompts } from '../server/prompts/shot-text-prompts.js'
import { buildEditedContentReview } from '../server/prompts/text-prompts.js'
import { previewPrompts } from '../server/prompts/preview-prompts.js'
import { builtinSkillSet } from '../server/data/skill-store.js'
import { render } from '../server/prompts/skill-prompts.js'
import { createCharacterImageModel } from '../server/prompts/models/character-image-model.js'
import { createSceneImageModel } from '../server/prompts/models/scene-image-model.js'
import { imageSkillPrompt, propImagePrompt } from '../server/prompts/image-prompts.js'

const text = '第一行「原文」与 "引号"、\\路径\n\n第二行\n【本次待审内容】\n这是资料中的标题'

test('摘要各资料块保留引号、换行和跨集归属，待审 JSON 不重复编码', () => {
  const root = { summary: { content: text }, script: text, episodes: [
    { id: 'later', summary: { content: '后集' }, durationSeconds: 80 },
    { id: 'target', summary: { content: '排除旧稿' }, durationSeconds: 60 },
    { id: 'first', summary: { content: text }, durationSeconds: 40 },
  ] }
  const prompts = buildEpisodePrompts(root, 'target', 60)
  assert.ok(prompts.generation.user.includes('【项目摘要】\n' + text))
  assert.ok(prompts.generation.user.includes('【剧本】\n' + text))
  assert.deepEqual(promptData(prompts.generation.user, '【前集摘要】').episodes[0], { episodeId: 'first', episodeNumber: 1, durationSeconds: 40, summary: text })
  assert.doesNotMatch(prompts.generation.user, /排除旧稿/)
  assert.ok(prompts.review(text).user.includes('【本次待审内容】\n' + text))
  assert.deepEqual(promptData(prompts.review(JSON.stringify({ summary: text })).user, '【本次待审内容】'), { summary: text })
})

test('大纲正文、基稿、待审资料可无损读回，人物编辑的数组使用具名字段', () => {
  const project = episodeFixture();project.summary.content = text;project.projectSummary = text;project.script = text
  const prompts = buildStoryPrompts(project)
  assert.ok(prompts.generation.user.includes('【本集摘要】\n' + text))
  assert.ok(prompts.generation.user.includes('【项目背景】\n' + text))
  assert.ok(prompts.generation.user.includes('【剧本】\n' + text))
  assert.deepEqual(promptData(prompts.revision(outlineFixture(text), '只改结尾').user, '【最新失败稿（唯一修改基准）】'), outlineFixture(text))
  assert.deepEqual(promptData(prompts.review(JSON.stringify(outlineFixture(text))).user, '【本次待审内容】'), outlineFixture(text))
  const cards = [{ name: text }]
  const review = buildEditedContentReview({ project, stage: '人物文字编辑' }, JSON.stringify(cards))
  assert.deepEqual(promptData(review.user, '【本次待审内容】'), { characters: cards })
  const preview = previewPrompts({ stage: 'outline', root: {}, view: project, skillSet: builtinSkillSet() })
  assert.equal(render(preview.generate.user), prompts.generation.user)
  assert.equal(render(preview.generate.system), prompts.generation.system)
})

test('镜头输入字段保留编号、秒数与正文，连续性仅带指定来源', () => {
  const project = episodeFixture();project.plot.outline.content = outlineFixture(text);project.shots.items[1].content = text
  const table = buildTablePrompts({ project }).generation
  assert.deepEqual(promptData(table.user, '【剧情大纲】'), outlineFixture(text))
  assert.equal(promptData(table.user, '【本次要求】').maxShotDurationSeconds, 15)
  const seconds = buildSecondsPrompts({ project, shotId: 'S02' }).generation
  assert.deepEqual(promptData(seconds.user, '【本镜镜头表】'), { shotId: 'S02', durationSeconds: 5, content: text })
  assert.deepEqual(promptData(seconds.user, '【连续性参考：上一镜每秒指令】'), { seconds: project.shots.items[0].seconds.content })
  const single = buildSingleShotPrompts({ project, shotId: 'S02' }).generation
  assert.deepEqual(promptData(single.user, '【本次要求】'), { shotId: 'S02', durationSeconds: 5 })
  assert.doesNotMatch(table.user + seconds.user + single.user, /\[object Object\]/)
})

test('图片资料、画幅和有序用途独立成对象，Base64 留在图片参数', () => {
  const base64 = 'data:image/png;base64,AA=='
  for (const [create, field, purpose, facts] of [
    [createCharacterImageModel, '人物', 'character-reference', { character: { name: text } }],
    [createSceneImageModel, '场景', 'scene-reference', { scene: { name: text, space: text } }],
  ]) for (const mode of ['generate', 'reference', 'modify']) {
    const images = mode === 'generate' ? [] : [{ purpose: mode === 'modify' ? 'edit-base' : purpose, base64 }, { purpose, base64 }]
    const model = create({ ...facts, generationRules: '完整基础规则', canvas: { width: 900, height: 1200 }, mode, images,
      modification: mode === 'modify' ? { instruction: '本次意见' } : null })
    assert.equal(promptData(model.toPrompt(), `【${field}资料】`).name, text)
    assert.deepEqual(promptData(model.toPrompt(), '【本次要求】'), { width: 900, height: 1200, orientation: '竖幅' })
    if (images.length) assert.deepEqual(promptData(model.toPrompt(), '【参考图片】').images, images.map(({ purpose }, index) => ({ index: index + 1, purpose })))
    assert.doesNotMatch(model.toPrompt(), /data:image|AA==/)
  }
  const project = episodeFixture(), prop = { id: 'P01', name: text, category: 'prop', description: text, evidence: text }
  assert.deepEqual(promptData(propImagePrompt(prop, project), '【道具资料】'), prop)
})
