import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { compilePromptSnapshot } from '../../lib/prompts/compiler.js'
import { createProjectAggregate } from '../../lib/domain/spec.js'
import { canvasReadModel } from '../../lib/domain/read-models.js'
import { CANVAS_STAGES, canvasStageForNode, nodesForCanvasStage } from '../../studio/stages.js'
import { loadBuiltinManifests } from '../../lib/manifest.js'
import { _internals } from '../../lib/index.js'

function fixture() {
  const project = createProjectAggregate({ id: 'h3-dialogue' })
  project.characters.fox = { id: 'fox', name: '小狐狸' }
  project.shots.fox = {
    id: 'fox', title: '分镜 1', prompt: 'A fox looks at the stars.', shotDescription: '小狐狸仰望星空。',
    audioDialogue: '小狐狸：我要当宇航员！', audioNotes: '童声，兴奋；风声很轻。',
  }
  return project
}

for (const capability of ['video.reference2video', 'video.image2video']) {
  test(`${capability} compiles dialogue and sound notes without duplication`, () => {
    const project = fixture()
    const input = { project, shotId: 'fox', capability }
    const first = compilePromptSnapshot(input)
    assert.match(first.prompt, /\(S1\) 小狐狸 says <d>\[Chinese\] 我要当宇航员！<\/d>/)
    const section = capability === 'video.image2video' ? 'integrated_multimodal_description' : 'detailed_description'
    assert.match(first.prompt.slice(first.prompt.indexOf(section + ':')), /<d>[^]*overall_soundscape:/)
    assert.match(first.prompt, /overall_soundscape:[^]*童声，兴奋；风声很轻。/)
    assert.match(first.prompt, /natively together with the video/)
    const second = compilePromptSnapshot({ ...input, prompt: first.prompt })
    assert.equal((second.prompt.match(/<d>/g) || []).length, 1)
    assert.equal((second.prompt.match(/风声很轻/g) || []).length, 1)
    project.shots.next = { prompt: 'The fox turns around.', audioDialogue: '小狐狸：我们回家吧。' }
    assert.match(compilePromptSnapshot({ ...input, shotId: 'next' }).prompt, /\(S1\) 小狐狸 says/)
  })

  test(`${capability} fills missing speech in structured prompts verbatim`, () => {
    const project = fixture()
    const input = { project, shotId: 'fox', capability }
    project.shots.fox.audioDialogue = ''
    project.shots.fox.audioNotes = ''
    const structured = compilePromptSnapshot(input).prompt
    project.shots.fox.audioDialogue = '小狐狸：价格是 $&，不要改。'
    project.shots.fox.audioNotes = '童声 $1。'
    const result = compilePromptSnapshot({ ...input, prompt: structured })
    assert.ok(result.prompt.includes('<d>[Chinese] 价格是 $&，不要改。</d>'))
    assert.ok(result.prompt.includes('童声 $1。'))
  })

  test(`${capability} respects no-dialogue scenes and explicit silence`, () => {
    const project = fixture()
    const input = { project, shotId: 'fox', capability }
    project.shots.fox.audioDialogue = ''
    assert.doesNotMatch(compilePromptSnapshot(input).prompt, /<d>/)
    project.shots.fox.audioDialogue = '小狐狸：不要说这句。'
    const speaking = compilePromptSnapshot(input).prompt
    project.productionSpec.audioStrategy = 'silent'
    for (const prompt of [undefined, speaking]) {
      const result = compilePromptSnapshot({ ...input, prompt })
      assert.doesNotMatch(result.prompt, /不要说这句|风声很轻|<d>/)
      assert.match(result.prompt, /no audible dialogue/)
    }
    project.productionSpec.audioStrategy = 'native'
    project.legacyCanvas = { settings: { audioMode: 'silent' } }
    assert.match(compilePromptSnapshot(input).prompt, /no audible dialogue/)
  })
}

test('storyboard dialogue stays visible after video generation and only videos enter media', () => {
  const project = fixture()
  const first = canvasReadModel(project)
  const storyboard = first.nodes.find((node) => node.params?.shotId === 'fox')
  assert.match(storyboard.content, /小狐狸仰望星空。[^]*我要当宇航员！[^]*风声很轻/)
  assert.notEqual(canvasStageForNode(storyboard), 'media')
  project.legacyCanvas = { settings: { audioMode: 'native' }, nodes: [
    ...first.nodes, { id: 'fox', kind: 'video', media: 'fox.mp4' },
    { id: 'voice', kind: 'audio', title: '视频旁白' },
  ] }
  const view = canvasReadModel(project)
  assert.equal(view.nodes.length, first.nodes.length + 2)
  assert.equal(CANVAS_STAGES.find((stage) => stage.key === 'media').label, '视频')
  assert.deepEqual(nodesForCanvasStage(view.nodes, 'media').map((node) => node.id), ['fox'])
  assert.match(view.nodes.find((node) => node.params?.shotId === 'fox').content, /我要当宇航员！/)
  assert.equal(canvasStageForNode({ kind: 'text', title: '旁白与配音' }), null)
  assert.equal(canvasStageForNode({ kind: 'audio', stage: 'media', title: '旁白' }), null)
  assert.equal(canvasStageForNode({ kind: 'text', stage: 'media', title: '配音' }), null)
})

test('all active H3 tiers inject dialogue and save native audio inside video', () => {
  const registry = loadBuiltinManifests(fileURLToPath(new URL('../../workflows/', import.meta.url)))
  const project = fixture()
  for (const [family, capability] of [['ref2v', 'video.reference2video'], ['i2v', 'video.image2video']]) {
    for (const tier of ['fast', 'balanced', 'quality']) {
      const manifest = registry.byId[`elysium-minimax-h3-${family}-${tier}`]
      const snapshot = compilePromptSnapshot({ project, shotId: 'fox', capability, tier })
      const { graph } = _internals.buildRenderGraph(manifest, {
        prompt: snapshot.prompt, mode: tier, refs: ['fox.png'], first_frame: 'fox.png', prefix: 'test',
      }, '16:9')
      assert.equal(manifest.output.hasAudio, true)
      assert.ok(Object.values(graph).some((node) => Object.values(node.inputs || {}).includes(snapshot.prompt)))
      const video = Object.values(graph).find((node) => node.class_type === 'CreateVideo')
      assert.equal(graph[video.inputs.audio[0]].class_type, 'VAEDecodeAudio')
      assert.ok(Object.values(graph).some((node) => node.class_type === 'SaveVideo' && graph[node.inputs.video[0]] === video))
    }
  }
})

test('image generation does not receive spoken dialogue instructions', () => {
  const result = compilePromptSnapshot({ project: fixture(), shotId: 'fox', capability: 'image.text2image' })
  assert.doesNotMatch(result.prompt, /<d>|童声|我要当宇航员/)
})
