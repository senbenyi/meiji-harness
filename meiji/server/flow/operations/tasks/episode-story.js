// 任务：剧集剧情（大纲 → 角色 → 场景 → 道具；阶段 2 拆为四个小任务）
import { runTextSteps } from '../../../runtime/text-generation.js'
import { parseJsonValue } from '../../../gateway/model-gateway.js'
import { checkContext } from '../../../runtime/operation-context.js'
import { modelRoutes } from '../../../../models/model-config.js'
import { buildStoryPrompts } from '../../../prompts/story-prompts.js'
import { normalizeCharacters, normalizeScenes, normalizeProps } from '../../../../shared/story-content.js'
import { normalizeOutline } from '../../../../shared/story-outline.js'
import { preserveStoryAssets } from '../../../../shared/preserve-story-assets.js'
import { replaceFrom } from '../../../../shared/project-rules.js'
import { canGenerate } from '../../../../shared/generation-gates.js'
import { textSteps, storyTasks } from '../plan-steps.js'

export async function generateStoryPackage({ route, project, signal, fetchImpl, request, persist }) {
  const options = { route, project, signal, fetchImpl, request }
  const ctx = checkContext.getStore()
  const pending = () => ({ passed: null, failures: [] })
  const result = { outline: null, characters: { ...project.plot.characters, check: pending(), stale: true },
    scenes: { ...project.plot.scenes, check: pending(), stale: true }, checks: { outline: pending(), characters: pending(), scenes: pending(), props: pending() }, props: { ...project.plot.props, check: pending(), stale: true }, check: pending() }
  const save = async (kind, value, check, publish = true) => {
    if (kind === 'outline') result.outline = value
    else {
      const previous = project.plot[kind]?.items || []
      let next = Math.max(0, ...previous.map(item => Number(item.id.slice(1)) || 0))
      const prefix = { characters: 'C', scenes: 'E', props: 'P' }[kind]
      result[kind] = { ...value, items: value.items.map(item => ({ ...item, id: previous.find(old => old.name === item.name)?.id || `${prefix}${String(++next).padStart(2, '0')}` })), check, stale: false }
    }
    result.checks[kind] = check
    result.check = { passed: Object.values(result.checks).every(value => value.passed === true) ? true
      : Object.values(result.checks).some(value => value.passed === false) ? false : null,
      failures: Object.values(result.checks).flatMap(value => value.failures) }
    if (persist && publish) await persist({ ...result, phase: kind })
  }
  for (const kind of ['outline', 'characters', 'scenes', 'props']) {
    (signal || ctx?.signal)?.throwIfAborted()
    if (ctx) ctx.target = { ...ctx.originalOperation, action: 'outline', stageKey: kind }
    const input = kind === 'outline' ? project : { ...project, plot: { ...project.plot, outline: { ...project.plot.outline, content: result.outline }, characters: result.characters, scenes: result.scenes } }
    const normalize = text => {
      const raw = parseJsonValue(text)
      if (kind === 'outline') return normalizeOutline(raw)
      if (Object.keys(raw).length !== 1 || !Array.isArray(raw.items)) throw new Error('提取结果仅允许 items 数组')
      return kind === 'props' ? normalizeProps(raw, input) : (kind === 'characters' ? normalizeCharacters : normalizeScenes)(raw)
    }
    const generated = await runTextSteps({ target: kind,
      prompts: buildStoryPrompts(input, kind, '', { extraction: kind !== 'outline' }), options,
      check: text => { normalize(text); return [] },
      canPersist: text => { normalize(text); return true }, retainFailedDraft: kind === 'outline', persist: persist && ((text, check) => save(kind, normalize(text), check)) })
    await save(kind, normalize(generated.text), generated.check, false)
    if (!generated.check.passed) break
  }
  if (ctx) { ctx.target = ctx.originalOperation; ctx.validation = result.check.failures }
  return result
}

// if (operation.action === 'outline')
export async function opOutline(c) {
  let { deps, projects, models, project, trace, note } = c
  if (!canGenerate(project, 'outline')) throw Object.assign(new Error('请先写好本集摘要，再生成剧情'), { status: 409 })
  note('依次生成并审核剧情大纲、提取人物角色、提取场景、提取道具；每项独立调用模型，前项未通过则停止后项')
  const result = await (deps.generateStoryPackage || generateStoryPackage)({ route: (modelRoutes(await models.read())).story, project, persist: async result => {
    const merged = preserveStoryAssets(project, result)
    if (result.checks && checkContext.getStore()) checkContext.getStore().storyStages = true
    await projects.save(project.id, replaceFrom(project, 'outline', { plot: { ...project.plot, ...merged } }))
  } })
  const merged = preserveStoryAssets(project, result)
  if (result.checks && checkContext.getStore()) checkContext.getStore().storyStages = true
  const failures = result.check.failures
  if (checkContext.getStore()) checkContext.getStore().validation = failures
  const patch = replaceFrom(project, 'outline', { plot: { ...project.plot, ...merged } })
  await projects.save(project.id, patch, { final: true })
  note(`剧情已保存：大纲、${merged.characters.items.length} 张角色卡、${merged.scenes.items.length} 张场景卡、${merged.props.items.length} 张道具卡；${failures.length ? '自检未通过：' + failures.join('；') : '整包自检通过'}。镜头及后续内容已清空。`)
  return trace
}

export const operations = {
  outline: { label: '生成剧情（大纲、角色、场景、道具）', maxRevisions: 2, scope: 'episode', queue: 'text', agent: true, plan: () => ['outline', 'characters', 'scenes', 'props'].flatMap(textSteps), tasks: storyTasks, stage: 'episode', run: opOutline },
}
