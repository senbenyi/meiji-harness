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
import { createCharacterImageModel } from '../server/models/prompts/character-image-model.js'
import { createSceneImageModel } from '../server/models/prompts/scene-image-model.js'
import { imageSkillPrompt, propImagePrompt } from '../server/prompts/image-prompts.js'

const text = '第一行「原文」与 "引号"、\\路径\n\n第二行\n【本次待审内容】\n这是资料中的标题'

test('展示摘要只读本集故事，引号和換行无损，待审 JSON 不重复编码', () => {
 const root={episodes:[{id:'target',durationSeconds:60,plot:{outline:{content:outlineFixture(text)}}}]}
 const prompts=buildEpisodePrompts(root,'target')
 assert.deepEqual(promptData(prompts.generation.user,'【本集故事小段：摘要唯一来源】'),outlineFixture(text))
 const review=prompts.review(JSON.stringify({summary:text}))
 assert.deepEqual(promptData(review.user,'【本次待审内容】'),{summary:text})
})

test('大纲正文、基稿、待审资料可无损读回，人物编辑的数组使用具名字段', () => {
  const project = episodeFixture();project.summary.content = text;project.projectSummary = text;project.script = text
  const prompts = buildStoryPrompts(project)
  assert.ok(!prompts.generation.user.includes('【本集摘要】\n' + text))
  assert.ok(!prompts.generation.user.includes('【项目背景】\n' + text))
  assert.ok(prompts.generation.user.includes(text))
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
  assert.deepEqual(promptData(seconds.user, '【连续性参考：上一镜交接摘要】'), {
    shotId: 'S01', endState: '面北站定', camera: '摄影机位于身后，固定全景', space: '【庭院|E01】南门北墙', sound: '脚步声', ambient: [], music: [],
  })
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
    // 人物资料写成外观描述、不含姓名（避免被画成设定卡文字）；场景资料仍为结构化对象。
    if (field === '场景') assert.equal(promptData(model.toPrompt(), `【${field}资料】`).name, text)
    else assert.ok(!model.toPrompt().split('【人物资料】')[1].split('\n\n')[0].includes(text))
    assert.deepEqual(promptData(model.toPrompt(), '【本次要求】'), { width: 900, height: 1200, orientation: '竖幅' })
    if (images.length) assert.deepEqual(promptData(model.toPrompt(), '【参考图片】').images, images.map(({ purpose }, index) => ({ index: index + 1, purpose })))
    assert.doesNotMatch(model.toPrompt(), /data:image|AA==/)
  }
  const project = episodeFixture(), prop = { id: 'P01', name: text, category: 'prop', description: text, evidence: text }
  assert.deepEqual(promptData(propImagePrompt(prop, project), '【道具资料】'), prop)
})
