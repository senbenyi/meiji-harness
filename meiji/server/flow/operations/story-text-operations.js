import { checkContext } from '../../runtime/operation-context.js'
import { runTextSteps, reviewContent } from '../../runtime/text-generation.js'
import { buildStoryPrompts } from '../../prompts/story-prompts.js'
import { parseJsonValue } from '../../gateway/model-gateway.js'
import { required, normalizeCharacters, normalizeScenes, normalizeProps, outlineStructureFailures } from '../../../shared/story-content.js'
import { preserveStoryAssets } from '../../../shared/preserve-story-assets.js'
import { modelRoutes } from '../../../models/model-config.js'
import { plotPatch, contentNode, GenerationStatus, targetNode } from '../../../shared/drama-model.js'
import { runStep } from '../../runtime/task-execution.js'
import { characterFieldValues, characterLookText } from '../../../shared/character-facts.js'
import { replaceFrom } from '../../../shared/project-rules.js'
import { canGenerate } from '../../../shared/generation-gates.js'
import { overrideBlocker, overrideNodes } from '../../../shared/review-feedback.js'

// 大纲通过后依次提取人物、场景和道具，各阶段独立审核。
export async function generateStoryPackage({ route, project, signal, fetchImpl, request, persist }) {
  const options = { route, project, signal, fetchImpl, request }
  const ctx = checkContext.getStore()
  const pending = () => ({ passed: null, failures: [] })
  const result = { outline: '', characters: { ...project.plot.characters, check: pending(), stale: true },
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
      if (kind === 'outline') return required(text, '大纲是空的')
      const raw = parseJsonValue(text)
      if (Object.keys(raw).length !== 1 || !Array.isArray(raw.items)) throw new Error('提取结果仅允许 items 数组')
      return kind === 'props' ? normalizeProps(raw, input) : (kind === 'characters' ? normalizeCharacters : normalizeScenes)(raw)
    }
    const generated = await runTextSteps({ target: kind,
      prompts: buildStoryPrompts(input, kind, '', { extraction: kind !== 'outline' }), options,
      check: text => { normalize(text); return kind === 'outline' ? outlineStructureFailures(text, project.outputLanguage) : [] }, retainFailedDraft: kind === 'outline', persist: persist && ((text, check) => save(kind, normalize(text), check)) })
    await save(kind, normalize(generated.text), generated.check, false)
    if (!generated.check.passed) break
  }
  if (ctx) { ctx.target = ctx.originalOperation; ctx.validation = result.check.failures }
  return result
}

export async function regenerateCardGroup({ project, kind, route, review, persist, signal, fetchImpl, request }) {
  const normalize = text => kind === 'props' ? normalizeProps(parseJsonValue(text), project) : (kind === 'characters' ? normalizeCharacters : normalizeScenes)(parseJsonValue(text))
  const result = await runTextSteps({
    target: kind,
    prompts: buildStoryPrompts(project, kind, review),
    options: { route, project, signal, fetchImpl, request }, check: text => { normalize(text); return [] }, persist: persist && ((text, check) => persist({ ...normalize(text), check })),
  })
  return { ...normalize(result.text), check: result.check }
}

// if (operation.action === 'source')
async function opSource(c) {
  let { operation, projects, project, trace, note } = c
  const saved = await projects.saveSource(project.id, operation.fields)
  note(`已保存资料：${saved.title}，${saved.durationSeconds} 秒，${saved.aspectRatio}`)
  note('时长、画幅或摘要一变，后面的内容已清空，等待重新生成')
  return trace
}

// if (operation.action === 'characters' || operation.action === 'scenes')
async function opCharacters(c) {
  let { operation, deps, projects, models, project, trace, note } = c
  const kind = operation.action
  if (kind === 'props' && ['outline', 'characters', 'scenes'].some(key => project.plot[key].check.passed !== true || project.plot[key].stale)) throw Object.assign(new Error('请先完成并通过大纲、人物及场景审核，再提取道具'), { status: 409 })
  await projects.save(project.id, { activity: kind, activityError: null })
  const group = await (deps.regenerateCardGroup || regenerateCardGroup)({ project, kind, route: (modelRoutes(await models.read())).story, review: operation.review, persist: async group => {
    const merged = preserveStoryAssets(project, { outline: project.plot.outline.content, characters: project.plot.characters, scenes: project.plot.scenes, props: project.plot.props, [kind]: group, check: group.check })
    await projects.save(project.id, plotPatch(project, { [kind]: merged[kind] }))
  } })
  const merged = preserveStoryAssets(project, { outline: project.plot.outline.content, characters: project.plot.characters, scenes: project.plot.scenes, props: project.plot.props, [kind]: group, check: group.check })
  checkContext.getStore().validation = group.check.failures
  await projects.save(project.id, { ...plotPatch(project, { [kind]: merged[kind] }), activity: null })
  note(`${({ characters: '人物卡', scenes: '场景卡', props: '道具卡' })[kind]}已保存${group.check.passed ? '并通过自审' : '，自审未通过：' + group.check.failures.join('；')}`)
  return trace
}

async function opPropDelete(c) {
  const { operation, projects, project, trace, note } = c
  const item = project.plot.props.items.find(item => item.id === operation.itemId)
  if (!item) throw Object.assign(new Error('道具不存在'), { status: 404 })
  await projects.save(project.id, current => {
    const props = current.plot.props
    if (!props.items.some(item => item.id === operation.itemId)) throw Object.assign(new Error('道具不存在'), { status: 404 })
    const revision = props.revision + 1
    return {
      ...plotPatch(current, { props: { ...props, revision, check: { ...props.check, revision }, items: props.items.filter(item => item.id !== operation.itemId) } }),
      pendingImages: Object.fromEntries(Object.entries(current.pendingImages || {}).filter(([, draft]) => draft.itemId !== operation.itemId)),
      activity: null, activityError: null,
    }
  })
  note(`已删除道具 ${item.id} · ${item.name}`)
  return trace
}

// if (operation.action === 'scene-text')
async function opSceneText(c) {
  let { operation, deps, projects, models, project, trace, note } = c
  const scene = project.plot.scenes.items.find(item => item.id === operation.itemId)
  if (!scene) throw Object.assign(new Error('场景不存在'), { status: 404 })
  const fields = ['name', 'landmark', 'light', 'space', 'look']
  if (fields.some(key => scene[key] !== operation.original?.[key])) throw Object.assign(new Error('场景已更新，请刷新后编辑'), { status: 409 })
  const values = Object.fromEntries(fields.map(key => [key, String(operation.fields?.[key] || '').trim()]))
  if (Object.values(values).some(value => !value || value.length > 10000)) throw Object.assign(new Error('场景字段不能为空或超过10000字'), { status: 400 })
  if (values.name !== scene.name) throw Object.assign(new Error('场景名称用于素材关联，此处仅编辑描述'), { status: 400 })
  if (project.plot.scenes.items.some(item => item.id !== scene.id && item.name === values.name)) throw Object.assign(new Error('场景名称重复'), { status: 400 })
  project = await runStep('save', () => projects.save(project.id, { ...plotPatch(project, { scenes: { ...project.plot.scenes, items: project.plot.scenes.items.map(item => item.id === scene.id ? { ...item, ...values } : item) } }), activity: 'scene-text' }), { target: 'story' })
  const result = await (deps.reviewContent || reviewContent)({ project, stage: '场景文字编辑，仅审场景与大纲一致性，不要求重写大纲或人物卡', text: JSON.stringify(project.plot.scenes.items), route: (modelRoutes(await models.read())).story })
  checkContext.getStore().validation = result.failures
  await projects.save(project.id, { activity: null })
  note('场景文字已保存并完成自审，图片保留')
  return trace
}

// if (operation.action === 'character-text')
async function opCharacterText(c) {
  let { operation, deps, projects, models, project, trace, note } = c
  const character = project.plot.characters.items.find(item => item.id === operation.itemId)
  if (!character) throw Object.assign(new Error('人物不存在'), { status: 404 })
  const keys = ['nationality', 'name', 'role', 'gender', 'era', 'age', 'height', 'build', 'features']
  const current = characterFieldValues(character)
  if (keys.some(key => current[key] !== operation.original?.[key])) throw Object.assign(new Error('人物已更新，请刷新后编辑'), { status: 409 })
  const values = Object.fromEntries(keys.map(key => [key, String(operation.fields?.[key] || '').trim()]))
  if (Object.values(values).some(value => !value || value.length > 10000)) throw Object.assign(new Error('人物字段不能为空或超过10000字'), { status: 400 })
  values.costume = current.costume
  if (project.plot.characters.items.some(item => item.id !== character.id && item.name === values.name)) throw Object.assign(new Error('人物名称重复'), { status: 400 })
  const look = characterLookText(values)
  project = await runStep('save', () => projects.save(project.id, currentProject => {
    const items = currentProject.plot.characters.items.map(item => item.id === character.id ? { ...item, ...values, figure: '', look } : item)
    const patch = { ...plotPatch(currentProject, { characters: { ...currentProject.plot.characters, items } }), activity: 'character-text' }
    if (values.name === character.name || !currentProject.shots) return patch
    patch.shots = {
      ...currentProject.shots,
      items: currentProject.shots.items.map(shot => ({
        ...shot,
        cast: (shot.cast || []).map(name => name === character.name ? values.name : name),
        storyboard: Array.isArray(shot.storyboard?.content?.characters)
          ? { ...shot.storyboard, content: { ...shot.storyboard.content, characters: shot.storyboard.content.characters.map(name => name === character.name ? values.name : name) } }
          : shot.storyboard,
      })),
    }
    return patch
  }), { target: 'story' })
  const result = await (deps.reviewContent || reviewContent)({ project, stage: '人物文字编辑，仅审人物与大纲一致性，不要求重写大纲或场景卡', text: JSON.stringify(project.plot.characters.items), route: (modelRoutes(await models.read())).story })
  checkContext.getStore().validation = result.failures
  await projects.save(project.id, { activity: null })
  note('人物文字已保存并完成自审，图片保留')
  return trace
}

// if (operation.action === 'outline-text')
async function opOutlineText(c) {
  let { operation, deps, projects, models, project, trace, note } = c
  const outline = String(operation.outline || '').trim()
  if (!outline) throw Object.assign(new Error('大纲不能是空的'), { status: 400 })
  project = await runStep('save', () => projects.writeStep(project.id, 'outline', { ...plotPatch(project, { outline: contentNode(project.plot.outline, outline) }), activity: 'outline' }), { target: 'story' })
  const result = await (deps.reviewContent || reviewContent)({ project, stage: 'outline', text: JSON.stringify({ outline, characters: project.plot.characters.items, scenes: project.plot.scenes.items }), route: (modelRoutes(await models.read())).story })
  checkContext.getStore().validation = result.failures
  await projects.save(project.id, { activity: null })
  note(result.passed ? '大纲已保存并通过自检' : `大纲已保存，自检未通过：${result.failures.join('；')}`)
  return trace
}

// if (operation.action === 'outline')
async function opOutline(c) {
  let { deps, projects, models, project, trace, note } = c
  if (!canGenerate(project, 'outline')) throw Object.assign(new Error('请先写好本集摘要，再生成剧情'), { status: 409 })
  await projects.save(project.id, { activity: 'outline', activityError: null })
  note('依次生成并审核剧情大纲、提取人物角色、提取场景、提取道具；每项独立调用模型，前项未通过则停止后项')
  const result = await (deps.generateStoryPackage || generateStoryPackage)({ route: (modelRoutes(await models.read())).story, project, persist: async result => {
    const merged = preserveStoryAssets(project, result)
    if (result.checks && checkContext.getStore()) checkContext.getStore().storyStages = true
    await projects.save(project.id, replaceFrom(project, 'outline', { plot: { ...project.plot, ...merged }, activity: 'outline' }))
  } })
  const merged = preserveStoryAssets(project, result)
  if (result.checks && checkContext.getStore()) checkContext.getStore().storyStages = true
  const failures = result.check.failures
  if (checkContext.getStore()) checkContext.getStore().validation = failures
  const patch = replaceFrom(project, 'outline', { plot: { ...project.plot, ...merged }, activity: null })
  await projects.save(project.id, patch)
  note(`剧情已保存：大纲、${merged.characters.items.length} 张角色卡、${merged.scenes.items.length} 张场景卡、${merged.props.items.length} 张道具卡；${failures.length ? '自检未通过：' + failures.join('；') : '整包自检通过'}。镜头及后续内容已清空。`)
  return trace
}

// if (operation.action === 'review-override')
// 人工忽略自审：新任务，只含一个 override 步骤（执行者为人），把当前版本的不通过改为通过并保留原 AI 理由；原任务不变。
async function opReviewOverride(c) {
  let { operation, projects, project, trace, note } = c
  const key = String(operation.key || '')
  const blocked = overrideBlocker(project, key)
  if (blocked) throw Object.assign(new Error(blocked), { status: 409 })
  await runStep('override', async () => {
    await projects.save(project.id, current => {
      const reason = overrideBlocker(current, key)
      if (reason) throw Object.assign(new Error(reason), { status: 409 })
      const next = structuredClone(current), at = new Date().toISOString()
      for (const [item] of overrideNodes(next, key)) {
        const target = targetNode(next, item)
        target.check = { passed: true, failures: [], revision: target.revision, override: { at, actor: 'human', reasons: target.check.failures || [] } }
        target.status = GenerationStatus.PASSED
        target.error = null
      }
      return next
    })
    return { check: { passed: true, failures: [] } }
  }, { target: key })
  note(`已忽略自审并放行：${key}`)
  return trace
}

export const storyOperations = {
  'review-override': { stage: 'episode', run: opReviewOverride },
  'source': { stage: 'episode', run: opSource },
  'characters': { stage: 'episode', run: opCharacters },
  'scenes': { stage: 'episode', run: opCharacters },
  'props': { stage: 'episode', run: opCharacters },
  'prop-delete': { stage: 'episode', run: opPropDelete },
  'scene-text': { stage: 'episode', run: opSceneText },
  'character-text': { stage: 'episode', run: opCharacterText },
  'outline-text': { stage: 'episode', run: opOutlineText },
  'outline': { stage: 'episode', run: opOutline },
}
