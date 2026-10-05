import { compileVideoPrompt } from '../../server/prompts/video-prompt-renderer.js'
// 提示词场景：覆盖各阶段、各类请求（生成 / 审核 / 修订）与模式，供提示词组装测试与新旧差集对比使用。
// 命令行：node tests/fixtures/prompt-scenarios.js <输出.json>（需设置 MEIJI_MODELS_LOCAL）
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { episodeFixture } from './model.js'
import { checkContext } from '../../server/runtime/operation-context.js'
import { buildStoryPrompts } from '../../server/prompts/story-prompts.js'
import { buildEpisodePrompts } from '../../server/prompts/episode-summary-prompts.js'
import { buildSecondsPrompts, buildSingleShotPrompts, buildTablePrompts } from '../../server/prompts/shot-text-prompts.js'
import { buildEditedContentReview, buildTextPrompts } from '../../server/prompts/text-prompts.js'
import { characterImagePrompt } from '../../server/prompts/interfaces/character-image-interface.js'
import { imageSkillPrompt, propImagePrompt } from '../../server/prompts/image-prompts.js'
import { sceneStillPrompt } from '../../shared/image-assets.js'

const guidance = [{ id: 'g-action', name: '动作参考', guidanceType: 'action', content: '动作参考内容' }, { id: 'g-sound', name: '声音参考', guidanceType: 'sound', content: '声音参考内容' }]
const supplements = { outline: '【本剧】大纲补充', shots: '【本剧】镜头表补充', seconds: '【本剧】每秒补充', storyboard: '【本剧】分镜补充', film: '【本剧】成片补充' }

// 剧集视图（与 materialize 结果同形）：本剧补充、启用的指导与指导素材在 skills（改造前的基线由按集字段生成，内容相同）。
export function scenarioProject({ language = 'zh-CN', extras = true } = {}) {
  const episode = episodeFixture()
  const view = { ...episode, id: 'project-1', episodeId: episode.id, title: '测试剧', aspectRatio: '1344x768', style: '写实电影', outputLanguage: language,
    projectSummary: '旅人的冒险', script: '', episodeNumber: 1 }
  if (extras) {
    view.skills = { additions: Object.fromEntries(Object.entries({ outline: 'outline', shots: 'shots', seconds: 'seconds', storyboard: 'storyboard', film: 'video' }).map(([stage, id]) => [id, { generate: supplements[stage] }])),
      guidance: { enabled: ['action', 'dialogue', 'expression', 'sound'] }, assets: { outline: guidance, shots: guidance, seconds: guidance, storyboard: guidance, film: guidance } }
  }
  return view
}

function root(view) {
  return { title: view.title, summary: { content: view.projectSummary }, aspectRatio: view.aspectRatio, style: view.style, outputLanguage: view.outputLanguage, skills: view.skills,
    episodes: [{ id: 'e1', summary: { content: '第一集摘要' }, durationSeconds: 60}] }
}

const text = prompts => ({
  generation: prompts.generation,
  review: prompts.review('【待审内容】'),
  revision: prompts.revision('【失败稿】', JSON.stringify({ passed: false, issues: [{ location: '本次内容', reason: '【失败原因】', requirement: '修正问题' }] })),
})
const inMode = (mode, view, run) => checkContext.run(mode === 'modify' ? { generationMode: 'modify', review: '【人工意见】', batchReview: '【人工意见】', originalProject: view } : { generationMode: 'regenerate' }, run)

export async function buildScenarios() {
  const out = {}
  const add = (name, value) => { out[name] = value }
  for (const mode of ['regenerate', 'modify']) {
    const view = scenarioProject()
    inMode(mode, view, () => {
      add(`episode:${mode}`, text(buildEpisodePrompts(root(view), 'e1')))
      add(`outline:${mode}`, text(buildStoryPrompts(view)))
      add(`characters:${mode}`, text(buildStoryPrompts(view, 'characters')))
      add(`scenes:${mode}`, text(buildStoryPrompts(view, 'scenes')))
      add(`props:${mode}`, text(buildStoryPrompts(view, 'props')))
      add(`shots:${mode}`, text(buildTablePrompts({ project: view })))
      add(`seconds-shot:${mode}`, text(buildSecondsPrompts({ project: view, shotId: 'S01' })))
      add(`shot-revise:${mode}`, text(buildSingleShotPrompts({ project: view, shotId: 'S01', review: '【单镜意见】' })))
      add(`storyboard-program:${mode}`, { prompt: compileVideoPrompt(view,view.shots.items[0]).prompt.text })
    })
  }
  const view = scenarioProject()
  inMode('regenerate', view, () => {
    add('episode:new', text(buildEpisodePrompts(root(view))))
    add('characters:regenerate', text(buildStoryPrompts(view, 'characters')))
    add('scenes:regenerate', text(buildStoryPrompts(view, 'scenes')))
    add('outline:en', text(buildStoryPrompts(scenarioProject({ language: 'en' }))))
    add('storyboard:plain', { prompt: compileVideoPrompt(view,view.shots.items[0]).prompt.text })
    add('edited:storyboard', { review: buildEditedContentReview({ project: view, stage: 'storyboard', shotId: 'S01' }, '【编辑后正文】') })
    add('edited:outline', { review: buildEditedContentReview({ project: view, stage: 'outline' }, '【编辑后正文】') })
    add('image-prompt', text(buildTextPrompts({ skill: 'image-prompt', project: view, instructions: '原提示词：旅人\n新要求：换成夜景' })))
  })
  const scripted = { ...root(view), script: '旅人夜访庭院，敲门无人回应，读到旧友留下的信后离开。' }
  inMode('regenerate', scripted, () => add('episode:script', text(buildEpisodePrompts(scripted, 'e1', 38))))
  inMode('modify', scripted, () => add('episode:script-modify', text(buildEpisodePrompts(scripted, 'e1', 38))))
  add('project-summary:extract', text(buildTextPrompts({ skill: 'project-summary', project: scripted })))
  const card = view.plot.characters.items[0], scene = view.plot.scenes.items[0]
  add('image:character', { prompt: characterImagePrompt(card, view) })
  add('image:scene', { prompt: imageSkillPrompt('scene-image', sceneStillPrompt(scene), view) })
  add('image:part', { prompt: propImagePrompt({id: 'P01', name: '长衣', category: 'clothing', description: '灰色长衣', evidence: '旅人身穿灰色长衣'}, view) })
  return out
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const scenarios = await buildScenarios()
  await writeFile(process.argv[2], JSON.stringify(scenarios, null, 2))
  console.log(Object.keys(scenarios).length, 'scenarios')
}
