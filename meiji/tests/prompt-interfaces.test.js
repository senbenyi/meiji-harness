import { storyboardFixture } from './fixtures/storyboard.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTextPrompts } from '../server/prompts/text-prompts.js'
import { previewPrompts } from '../server/prompts/preview-prompts.js'
import { render, segment } from '../server/prompts/skill-prompts.js'
import { imageSegments, textInterface } from '../server/prompts/interfaces/prompt-interfaces.js'
import characterInterface from '../server/prompts/interfaces/character-image-interface.js'
import { FilmModel } from '../server/prompts/models/video-prompt-model.js'
import { runTextRequest } from '../server/gateway/model-gateway.js'
import { imageSkillPrompt } from '../server/prompts/image-prompts.js'
import { filmSubmit } from '../server/flow/operations/video-operations.js'
import { checkContext } from '../server/runtime/operation-context.js'
import { executionContext } from '../server/runtime/task-context.js'
import { builtinSkillSet } from '../server/data/skill-store.js'
import { reviewRequest } from '../server/prompts/prompt-request.js'

const stages = ['episode', 'outline', 'shots', 'shot-revise', 'seconds', 'image-prompt']
const project = { outputLanguage: 'en', style: '水彩', skills: {} }
const task = skill => ({ skill, project, instructions: '任务内容', reviewInstructions: '审核上下文' })
const piece = text => segment('context', '', text)

test('各文本接口可独立选择角色、顺序和 JSON 模式，公共层不补统一规则', async t => {
  for (const stage of stages) {
    const other = stage === 'episode' ? 'shots' : 'episode'
    const unchanged = buildTextPrompts(task(other)).generation
    const api = textInterface(stage)
    const generate = t.mock.method(api, 'generate', () => ({ json: false, system: [], user: [piece('先发上下文'), piece(stage)] }))
    const review = t.mock.method(api, 'review', (_task, text) => ({ json: false, system: [piece('本接口验收')], user: [piece(text)] }))
    const revise = t.mock.method(api, 'revise', (_task, text, reason) => ({ json: false, system: [piece(reason)], user: [piece(text), piece('定向修改')] }))
    try {
      const prompts = checkContext.run({ requirements: '不应由公共层强制注入' }, () => buildTextPrompts(task(stage)))
      assert.equal(prompts.generation.system, '')
      assert.equal(prompts.generation.user, `先发上下文\n\n${stage}`)
      assert.equal(prompts.generation.json, false)
      assert.equal(prompts.review('待审').system, '本接口验收')
      assert.equal(prompts.review('待审').user, '待审')
      assert.equal(prompts.revision('原稿', '原因').system, '原因')
      assert.equal(prompts.revision('原稿', '原因').user, '原稿\n\n定向修改')
      let payload
      await runTextRequest(prompts.generation, {
        route: { baseUrl: 'https://gateway.test/v1', apiKey: 'test', model: 'test-model' },
        fetchImpl: async (_url, options) => {
          payload = JSON.parse(options.body)
          return Response.json({ choices: [{ message: { content: '完成' } }] })
        },
      })
      assert.deepEqual(payload, { model: 'test-model', messages: [{ role: 'user', content: `先发上下文\n\n${stage}` }] })
      assert.deepEqual(buildTextPrompts(task(other)).generation, unchanged)
    } finally { generate.mock.restore(); review.mock.restore(); revise.mock.restore() }
  }
})

test('独立文本结构在预览中与发送内容一致', t => {
  t.mock.method(textInterface('image-prompt'), 'generate', () => ({ json: false, system: [piece('接口规则')], user: [piece('上下文在前'), piece('要求在后')] }))
  const preview = previewPrompts({ stage: 'image-prompt', root: project, skillSet: builtinSkillSet() }).generate
  const actual = buildTextPrompts(task('image-prompt')).generation
  assert.equal(render(preview.system), actual.system)
  assert.equal(render(preview.user), actual.user)
  assert.equal(preview.chars, actual.system.length + actual.user.length)
})

test('审核语言例外合并进原则，复用片段不串改或丢失来源', () => {
  const method = { ...segment('context', '【审核原则】', '只审明确冲突'), skill: 'outline' }, original = structuredClone(method)
  for (const outputLanguage of ['简体中文', 'English']) {
    const request = reviewRequest({ method, language: segment('language', '', `输出语言：${outputLanguage}`) })
    const blocks = request.system.filter(Boolean)
    assert.equal(blocks.length, 1)
    assert.equal(blocks[0].title, method.title)
    assert.equal(blocks[0].skill, method.skill)
    assert.match(blocks[0].text, /既定对白、歌词和画面文字保留原文/)
    assert.match(render(request.user), new RegExp(`输出语言：${outputLanguage}`))
    assert.deepEqual(method, original)
  }
})

test('人物图可独立取消默认包装，预览同步，场景图不受影响', t => {
  const scene = imageSkillPrompt('scene-image', '场景内容', project)
  t.mock.method(characterInterface, 'generate', () => [piece('自定义人物图结构')])
  const actual = imageSkillPrompt('character-image', '人物内容', project)
  assert.equal(actual, '自定义人物图结构')
  const preview = previewPrompts({ stage: 'character-image', root: project, skillSet: builtinSkillSet() }).image
  assert.equal(render(preview.user), actual)
  assert.equal(preview.chars, actual.length)
  assert.equal(imageSkillPrompt('scene-image', '场景内容', project), scene)
})

test('图片接口与预览使用同一基础规则，旧的本剧覆盖不再生效', () => {
  for (const stage of ['scene-image', 'part-image', 'pencil']) {
    const set = builtinSkillSet({ additions: { [stage]: { generate: '本剧补充' } } })
    set.skills[stage].constraints = `基础规则：${stage}`
    const actual = executionContext.run({ skillSet: set, skills: new Map() }, () => imageSkillPrompt(stage, '画面', project))
    assert.ok(stage === 'scene-image' ? actual.includes(`【基础规则】\n基础规则：${stage}`) : actual.includes(`【基础生产规则】\n基础规则：${stage}`))
    assert.doesNotMatch(actual, /本剧补充/)
    const preview = previewPrompts({ stage, root: project, skillSet: set }).image
    assert.ok(stage === 'scene-image' ? render(preview.user).includes(`【基础规则】\n基础规则：${stage}`) : render(preview.user).includes(`【基础生产规则】\n基础规则：${stage}`))
    assert.equal(preview.chars, render(preview.user).length)
  }
})

test('视频独立模块拥有补充、意见与衔接规则，流程层按原样使用', () => {
  const view = { ...project, plot: { characters: { items: [{ name: '甲', localPath: '/plugins/meiji/asset-file?category=characters&id=a' }] }, scenes: { items: [] } } }
  const set = builtinSkillSet({ additions: { video: { generate: '视频独立补充' } } })
  const item = { id: 'S01', format: 'text', video: 'reference', characters: ['甲'], prompt: { text: storyboardFixture('<Picture 1> 甲') } }
  const opening = { referenceUrl: 'https://image.test/tail', previous: 'S00' }
  executionContext.run({ skillSet: set, skills: new Map() }, () => checkContext.run({ review: '节奏加快' }, () => {
    const expected = render(new FilmModel({ project: view, prompt: item.prompt.text, mode: 'reference', opening, imageCount: 1 }).toGenerateSegments())
    const actual = filmSubmit(view, item, opening)
    assert.equal(actual.prompt, expected)
    assert.deepEqual(actual.referenceImages, ['/plugins/meiji/asset-file?category=characters&id=a', opening.referenceUrl])
    assert.doesNotMatch(actual.prompt, /视频独立补充/)
    assert.match(actual.prompt, /身份、动作、对白、场景与时间保持连续/)
    assert.match(actual.prompt, /节奏加快/)
    assert.match(actual.prompt, /<Picture 2>/)
  }))
  const preview = previewPrompts({ stage: 'video', root: view, skillSet: set }).video
  assert.equal(render(preview.user), render(new FilmModel({ project: view, prompt: '（已审核的文本分镜最终视频提示词）', skillSet: set, mode: 'reference' }).toGenerateSegments()))
  assert.equal(preview.chars, render(preview.user).length)
})

test('未注册接口显式报错，不自动套用通用模板', () => {
  for (const stage of ['missing', 'toString', '__proto__']) {
    assert.throws(() => buildTextPrompts(task(stage)), /未定义文本接口提示词/)
    assert.throws(() => imageSegments({ stage, project, request: '' }), /未定义图片接口提示词/)
  }
})
