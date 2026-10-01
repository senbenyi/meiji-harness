// 提示词场景：覆盖各阶段、各类请求（生成 / 审核 / 修订）与模式，供提示词组装测试与新旧差集对比使用。
// 命令行：node tests/fixtures/prompt-scenarios.js <输出.json>（需设置 MEIJI_MODELS_LOCAL）
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { episodeFixture } from './model.js'
import { checkContext } from '../../server/data/operation-context.js'
import { buildStoryPrompts } from '../../server/prompts/story-prompts.js'
import { buildEpisodePrompts } from '../../server/prompts/episode-prompts.js'
import { buildAllSecondsPrompts, buildSecondsPrompts, buildSingleShotPrompts, buildStoryboardPrompts, buildTablePrompts } from '../../server/prompts/shot-prompts.js'
import { buildEditedContentReview, buildTextPrompts } from '../../server/prompts/text-prompts.js'
import { characterImagePrompt, imageSkillPrompt, partPrompt, pencilPrompt, sceneStillPrompt } from '../../server/generate/image.js'

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
  revision: prompts.revision('【失败稿】', 'FAIL 【失败原因】'),
})
const inMode = (mode, view, run) => checkContext.run(mode === 'modify' ? { generationMode: 'modify', review: '【人工意见】', originalProject: view } : { generationMode: 'regenerate' }, run)

export async function buildScenarios() {
  const out = {}
  const add = (name, value) => { out[name] = value }
  for (const mode of ['regenerate', 'modify']) {
    const view = scenarioProject()
    inMode(mode, view, () => {
      add(`episode:${mode}`, text(buildEpisodePrompts(root(view), 'e1')))
      add(`outline:${mode}`, text(buildStoryPrompts(view)))
      add(`shots:${mode}`, text(buildTablePrompts({ project: view })))
      add(`seconds-all:${mode}`, text(buildAllSecondsPrompts({ project: view }, view)))
      add(`seconds-shot:${mode}`, text(buildSecondsPrompts({ project: view, shotId: 'S01' })))
      add(`shot-revise:${mode}`, text(buildSingleShotPrompts({ project: view, shotId: 'S01', review: '【单镜意见】' })))
      for (const video of ['text', 'reference']) {
        add(`storyboard-${video}:${mode}`, text(buildStoryboardPrompts({ project: view, shotId: 'S01' }, { shot: view.shots.items[0], video, characters: ['旅人'], scenes: ['庭院'],
          refs: video === 'reference' ? '<Picture 1> 旅人' : '', images: video === 'reference' ? [{ url: '/plugins/meiji/asset-file?category=characters&id=a', label: '旅人', kind: 'characters' }] : [] })))
      }
    })
  }
  const view = scenarioProject()
  inMode('regenerate', view, () => {
    add('episode:new', text(buildEpisodePrompts(root(view))))
    add('characters:regenerate', text(buildStoryPrompts(view, 'characters')))
    add('scenes:regenerate', text(buildStoryPrompts(view, 'scenes')))
    add('outline:en', text(buildStoryPrompts(scenarioProject({ language: 'en' }))))
    add('storyboard:plain', text(buildStoryboardPrompts({ project: scenarioProject({ extras: false }), shotId: 'S01' }, { shot: view.shots.items[0], video: 'text', characters: ['旅人'], scenes: ['庭院'], refs: '', images: [] })))
    add('edited:storyboard', { review: buildEditedContentReview({ project: view, stage: 'storyboard', shotId: 'S01' }, '【编辑后正文】') })
    add('edited:outline', { review: buildEditedContentReview({ project: view, stage: 'outline' }, '【编辑后正文】') })
    add('image-prompt', text(buildTextPrompts({ skill: 'image-prompt', project: view, instructions: '原提示词：旅人\n新要求：换成夜景' })))
  })
  const card = view.plot.characters.items[0], scene = view.plot.scenes.items[0]
  add('image:character', { prompt: characterImagePrompt(card, view) })
  add('image:scene', { prompt: imageSkillPrompt('scene-image', sceneStillPrompt(scene), view) })
  add('image:part', { prompt: imageSkillPrompt('part-image', partPrompt(card, 'clothes'), view) })
  add('image:pencil', { prompt: imageSkillPrompt('pencil', pencilPrompt(view.shots.items[0].storyboard.content), view) })
  return out
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const scenarios = await buildScenarios()
  await writeFile(process.argv[2], JSON.stringify(scenarios, null, 2))
  console.log(Object.keys(scenarios).length, 'scenarios')
}
