import test from 'node:test'
import assert from 'node:assert/strict'
import { episodeFixture } from './fixtures/model.js'
import { outlineFixture, storyPackageFixture } from './fixtures/story-package.js'
import { reviewPass, reviewFail } from './fixtures/review-result.js'
import { generateStoryPackage } from './fixtures/story-generation.js'
import { generateShots, reviseShot } from '../server/flow/tasks/text/task-shot-table.js'
import { readShotSections } from '../server/flow/steps/step-generate-shot-table.js'
import { StoryModel } from '../server/prompts/models/story-model.js'
import { TextStepModel, textSteps } from '../server/prompts/models/text-step-model.js'
import { protocols } from '../skills/output-protocols.js'

const content = '- 事件：旅人读到 "明天见"。\n- 结果：保留\\书页上的原文。'
const shot = { shotId: 'S01', durationSeconds: 5, title: '读信1', content }
const response = shots => JSON.stringify({ shots })

test('所有文本生成/修订都启用 JSON 模式，协议示例为对象', () => {
  for (const kind of Object.keys(textSteps)) {
    const model = new TextStepModel(kind, { project: episodeFixture(), instructions: '本次任务' })
    assert.equal(model.toGenerateSegments().json, true)
    assert.equal(model.toReviseSegments('基稿', '意见').json, true)
    assert.equal(model.toReviewSegments('正文').json, true)
  }
  for (const kind of ['outline', 'characters', 'scenes']) {
    const model = new StoryModel(kind, { project: episodeFixture() })
    assert.equal(model.toGenerateSegments().json, true)
    assert.equal(model.toReviseSegments({ baseContent: '基稿', opinion: '意见' }).json, true)
  }
  for (const stage of ['shots', 'shot-revise', 'image-prompt']) {
    const example = protocols[stage].split(/示例[^\n]*：\n/)[1]
    assert.ok(JSON.parse(example) && !Array.isArray(JSON.parse(example)))
  }
})

test('大纲修订返回对象，解析换行后审核、提取与保存使用同一正文', async () => {
  const project = episodeFixture(), fixture = storyPackageFixture()
  const draft = outlineFixture('原稿 "引号"\n第二行'), repaired = outlineFixture('最新稿 "引号"\n第二行')
  const replies = [JSON.stringify(draft), reviewFail('修改正文'), JSON.stringify(repaired), reviewPass,
    JSON.stringify(fixture.characters), reviewPass, JSON.stringify(fixture.scenes), reviewPass, JSON.stringify({ items: [] }), reviewPass]
  const saved = [], calls = []
  const result = await generateStoryPackage({ project, request: async message => { calls.push(message); return replies.shift() }, persist: value => saved.push(structuredClone(value)) })
  assert.deepEqual(result.outline, repaired)
  assert.deepEqual(saved.at(-1).outline, repaired)
  assert.equal(result.check.passed, true)
  assert.ok(calls[4].user.includes(JSON.stringify(repaired)))
  assert.ok(saved.some(value => JSON.stringify(value.outline) === JSON.stringify(draft) && value.checks.outline.passed === false))
})

for (const raw of ['不是 JSON', JSON.stringify({ outline: 123 }), JSON.stringify({ outline: '' }), JSON.stringify({ outline: '正文', extra: true }), JSON.stringify(['正文'])]) {
  test(`非法大纲对象不能发布：${raw}`, async () => {
    let calls = 0, saves = 0
    await assert.rejects(generateStoryPackage({ project: episodeFixture(), request: async message => { calls++; return message.skill === 'review' ? reviewPass : raw }, persist: () => saves++ }), /自审未通过/)
    assert.equal(calls, 6);assert.equal(saves, 0)
  })
}

test('镜头 JSON 保存标题与真实换行，单镜修订保留其他镜头与素材', async () => {
  const project = episodeFixture()
  const result = await generateShots({ project, request: async message => message.skill === 'review' ? reviewPass : response([shot, { ...shot, shotId: 'S02', title: '读信2' }]) })
  assert.equal(result.items[0].content, `标题：读信1\n${content}`)
  const next = { ...shot, shotId: 'S02', title: '读信2', content: content + '\n- 新增：查看信封。' }
  const revised = await reviseShot({ project: { ...project, shots: result }, shotId: 'S02', review: '补充信封', request: async message => message.skill === 'review' ? reviewPass : response([next]) })
  assert.deepEqual(revised.items[0], result.items[0])
  assert.equal(revised.items[1].content, `标题：${next.title}\n${next.content}`)
  assert.deepEqual(revised.items[1].cast, result.items[1].cast)
})

for (const patch of [{ shotId: 'S02' }, { durationSeconds: '5' }, { durationSeconds: 16 }, { durationSeconds: 1.5 }, { title: '' }, { title: '标题\n换行' }, { content: 123 }, { content: '' }, { extra: true }]) {
  test(`镜头字段校验：${JSON.stringify(patch)}`, () => assert.throws(() => readShotSections(response([{ ...shot, ...patch }])), /S01/))
}

for (const shots of [[{ ...shot, shotId: 'S02', durationSeconds: 4 }], [{ ...shot, shotId: 'S02' }, { ...shot, shotId: 'S03' }], [shot]]) {
  test(`单镜不能改变时长、扩大范围或返回错误编号：${JSON.stringify(shots.map(s => [s.shotId, s.durationSeconds]))}`, async () => {
    let saves = 0
    await assert.rejects(reviseShot({ project: episodeFixture(), shotId: 'S02', review: '补充正文', request: async message => message.skill === 'review' ? reviewPass : response(shots), persist: () => saves++ }), /自审未通过/)
    assert.equal(saves, 0)
  })
}
