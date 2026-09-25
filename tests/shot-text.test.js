import test from 'node:test'
import assert from 'node:assert/strict'
import { generateShots, generateShotSeconds, generateShotStoryboard, reviseShot } from '../server/generate/shot-text.js'
import { shotReferenceImages } from '../client/reference-images.js'
import { shotSecondsReady } from '../client/shot-timing.js'
import { clearShotDownstream } from '../server/flow/gates.js'
import { previewFilmSubmit } from '../server/flow/actions.js'
import { checkContext } from '../server/data/self-checks.js'
import { askSkill } from '../server/generate/chat.js'

const raw = '他喊：“停下！”\n0–5s：雨中举手，{这里不是 JSON。'
const base = () => ({ title: '测试', durationSeconds: 31, outline: '雨夜撤离', characters: { items: [] }, scenes: { items: [] }, shots: { items: [{ id: 'S01', duration: 10, text: raw, secondsText: raw, cast: [], format: 'text' }] } })
const request = async skill => skill === 'meiji-content-review' ? 'PASS' : raw

test('program assigns IDs and duration while preserving arbitrary model text verbatim', async () => {
  const calls = []
  const saved = []
  const result = await generateShots({ project: base(), persist: async value => saved.push(structuredClone(value)), request: async (skill, prompt) => { calls.push({ skill, prompt }); return request(skill) } })
  assert.deepEqual(result.items.map(s => s.id), ['S01', 'S02', 'S03'])
  assert.equal(result.items.reduce((total, s) => total + s.duration, 0), 31)
  assert.ok(result.items.every(s => s.duration <= 15 && s.text === raw))
  assert.equal(saved.length, 3)
  assert.equal(result.check.passed, true)
  assert.ok(calls.filter(c => c.skill === 'meiji-content-review').every(c => c.prompt.includes(raw)))
  assert.equal(calls.length, 6)
})

test('failed text review preserves original and opinion without regeneration', async () => {
  let calls = 0
  const result = await generateShots({ project: { ...base(), durationSeconds: 10 }, request: async skill => { calls++; return skill === 'meiji-content-review' ? 'FAIL\n遗漏撤离原因。' : raw } })
  assert.equal(calls, 2)
  assert.equal(result.items[0].text, raw)
  assert.equal(result.items[0].reviewText, 'FAIL\n遗漏撤离原因。')
  assert.equal(result.check.passed, false)
})

test('review transport failure does not discard generated content or retry', async () => {
  const result = await generateShots({ project: { ...base(), durationSeconds: 10 }, request: async skill => { if (skill === 'meiji-content-review') throw new Error('network'); return raw } })
  assert.equal(result.items[0].text, raw)
  assert.match(result.items[0].reviewText, /审核未完成/)
})

test('seconds remain free text and only the requested shot changes', async () => {
  const project = base()
  project.shots.items.push({ id: 'S02', duration: 5, text: '保留' })
  const result = await generateShotSeconds({ project, shotId: 'S01', request })
  assert.equal(result.items[0].secondsText, raw)
  assert.equal(result.items[1], project.shots.items[1])
  assert.equal(shotSecondsReady(result.items[0]), true)
  const patch = clearShotDownstream({ ...project, shots: result }, 'shots', 'S01')
  assert.equal(shotSecondsReady(patch.shots.items[0]), false)
})

test('revising a shot preserves metadata and other shots while clearing seconds', async () => {
  const project = base()
  project.shots.items.push({ id: 'S02', text: '保留' })
  const result = await reviseShot({ project, shotId: 'S01', review: '保留雨夜', request })
  assert.equal(result.items[0].id, 'S01')
  assert.equal(result.items[0].text, raw)
  assert.equal(result.items[0].secondsText, '')
  assert.equal(result.items[1], project.shots.items[1])
})

test('storyboard sends free text and fixed references; later asset edits cannot reorder submission', async () => {
  const project = base()
  project.characters.items = [{ id: 'C01', name: '甲', imageUrl: 'https://example.test/a', assetId: 'a' }]
  project.scenes.items = [{ id: 'E01', name: '雨巷', imageUrl: 'https://example.test/b', assetId: 'b' }]
  Object.assign(project.shots.items[0], { cast: ['甲'], scene: '雨巷' })
  const calls = []
  const boards = await generateShotStoryboard({ project, shotId: 'S01', request: async (skill, prompt) => { calls.push(prompt); return request(skill) } })
  const board = boards[0]
  assert.equal(board.video, 'reference')
  assert.equal(board.prompt.text, raw)
  assert.match(calls[0], /<Picture 1> 人物「甲」 URL: https:\/\/example.test\/a/)
  assert.match(calls[0], /<Picture 2> 场景「雨巷」/)
  project.characters.items[0].imageUrl = 'https://example.test/changed'
  project.scenes.items = []
  assert.deepEqual(shotReferenceImages(project, board).map(i => i.url), ['https://example.test/a', 'https://example.test/b'])
  const payload = previewFilmSubmit(project, board)
  assert.equal(payload.prompt, raw)
  assert.deepEqual(payload.referenceImages, ['https://example.test/a', 'https://example.test/b'])
})

test('no image means text mode; unconfirmed local image is not submitted', async () => {
  const project = base()
  assert.equal((await generateShotStoryboard({ project, shotId: 'S01', request }))[0].video, 'text')
  project.characters.items = [{ id: 'C01', name: '甲', localPath: '/plugins/meiji/image' }]
  project.shots.items[0].cast = ['甲']
  await assert.rejects(generateShotStoryboard({ project, shotId: 'S01', request }), /确认并上传/)
})

test('free-text generation and review requests disable JSON response format', async () => {
  for (const skill of ['meiji-shots', 'meiji-revise-shot', 'meiji-shot-seconds', 'meiji-storyboard', 'meiji-content-review']) {
    await askSkill(skill, raw, { project: base(), ...(skill === 'meiji-content-review' ? { json: false, includeReview: false } : {}), route: { baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'test' }, fetchImpl: async (_url, options) => {
      assert.equal(JSON.parse(options.body).response_format, undefined)
      return Response.json({ choices: [{ message: { content: raw }, finish_reason: 'stop' }] })
    } })
  }
})

test('text failure participates in shared feedback context', async () => {
  await checkContext.run({}, async () => {
    await generateShotStoryboard({ project: base(), shotId: 'S01', request: async skill => skill === 'meiji-content-review' ? 'FAIL\n缺少关键对白' : raw })
    assert.deepEqual(checkContext.getStore().validation, ['FAIL\n缺少关键对白'])
  })
})

test('correction uses original snapshot after downstream clearing and audits the revised text', async () => {
  const original = base()
  original.shots.items[0].secondsText = '原指令：人物面朝北，摄影机在背后。'
  original.feedback = { 'seconds:S01': { check: { passed: false, failures: ['机位变化没有交代'] }, review: { text: '保留雨声' } } }
  const cleared = { ...original, shots: { items: [{ ...original.shots.items[0], secondsText: '' }] } }
  const calls = []
  await checkContext.run({ originalProject: original }, async () => {
    const result = await generateShotSeconds({ project: cleared, shotId: 'S01', request: async (skill, prompt) => {
      calls.push({ skill, prompt })
      return skill === 'meiji-content-review' ? 'PASS' : '修订指令：保持朝北，机位绕行右侧，雨声持续。'
    } })
    assert.match(calls[0].prompt, /原指令：人物面朝北/)
    assert.match(calls[0].prompt, /机位变化没有交代/)
    assert.match(calls[0].prompt, /保留雨声/)
    assert.match(calls[0].prompt, /不从头另写/)
    assert.equal(calls[1].skill, 'meiji-content-review')
    assert.match(calls[1].prompt, /修订指令：保持朝北/)
    assert.match(result.items[0].secondsText, /^修订指令/)
    assert.deepEqual(checkContext.getStore().validation, [])
  })
})

test('correcting the table preserves existing shot boundaries and associations', async () => {
  const project = base()
  project.shots.items = [{ id: 'S01', duration: 7, text: '开场原文', cast: ['甲'], scene: '街道' }, { id: 'S02', duration: 8, text: '结尾原文', cast: [], scene: '屋内' }]
  const prompts = []
  const result = await generateShots({ project, review: '加强风声', request: async (skill, prompt) => { if (skill !== 'meiji-content-review') prompts.push(prompt); return request(skill) } })
  assert.deepEqual(result.items.map(item => [item.id, item.duration, item.cast, item.scene]), project.shots.items.map(item => [item.id, item.duration, item.cast, item.scene]))
  assert.match(prompts[0], /开场原文/)
  assert.match(prompts[1], /结尾原文/)
})

test('storyboard correction retains the old prompt as draft and reviews the returned revision', async () => {
  const original = base()
  original.storyboard = [{ id: 'S01', prompt: { text: 'Original north-facing shot.' } }]
  const calls = []
  await checkContext.run({ originalProject: original, review: '补充机位轨迹' }, async () => {
    await generateShotStoryboard({ project: { ...original, storyboard: [] }, shotId: 'S01', request: async (skill, prompt) => { calls.push({ skill, prompt }); return request(skill) } })
    assert.match(calls[0].prompt, /Original north-facing shot/)
    assert.match(calls[0].prompt, /补充机位轨迹/)
    assert.match(calls[0].prompt, /返回修改后的完整正文/)
    assert.equal(calls[1].skill, 'meiji-content-review')
  })
})

test('storyboard matches names in raw shot and seconds to character and episode scene URLs', async () => {
  const project = base()
  project.characters.items = [{ id: 'C01', name: '黄征', imageUrl: 'https://example.test/person' }, { id: 'C02', name: '华雄', imageUrl: 'https://example.test/unused' }]
  project.scenes.items = [{ id: 'E01', name: '工厂门口', imageUrl: 'https://example.test/outside' }, { id: 'E02', name: '工厂走廊', imageUrl: 'https://example.test/inside' }]
  Object.assign(project.shots.items[0], { text: '黄征站在工厂门口', secondsText: '黄征进入工厂走廊。' })
  const [board] = await generateShotStoryboard({ project, shotId: 'S01', request })
  assert.equal(board.video, 'reference')
  assert.deepEqual(board.characters, ['黄征'])
  assert.deepEqual(board.scenes, ['工厂门口', '工厂走廊'])
  assert.deepEqual(previewFilmSubmit(project, board).referenceImages, ['https://example.test/person', 'https://example.test/outside', 'https://example.test/inside'])
  project.characters.items = []
  const [sceneOnly] = await generateShotStoryboard({ project, shotId: 'S01', request })
  assert.equal(sceneOnly.video, 'reference')
})
