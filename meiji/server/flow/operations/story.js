// 剧情与镜头文本操作：原始资料、大纲/角色/场景、镜头表、每秒指令、文本分镜。
import { runStep } from '../../data/task-store.js'
import { selectCheck } from '../../data/review-checks.js'
import { checkContext } from '../../data/operation-context.js'
import { preserveStoryAssets } from '../../data/story-package.js'
import { storyboardTextPatch } from '../../data/storyboard-edit.js'
import { loadModels } from './services.js'
import { reviewContent } from '../../generate/review.js'
import { generateAllSeconds, generateShotSeconds, generateShotStoryboard, generateShots, generateStoryPackage, generateStoryboard, regenerateCardGroup, reviseShot } from '../../generate/story.js'
import { GenerationStatus, contentNode, finish, node, plotPatch, targetNode, updateShotResults } from '../../../shared/drama-model.js'
import { feedbackOf, overrideBlocker, overrideNodes } from '../../../shared/feedback.js'
import { clearShotDownstream, replaceFrom } from '../../../shared/project-rules.js'
import { canGenerate, hasShots } from '../../../shared/gates.js'
import { shotSecondsReady } from '../../../shared/shot-timing.js'
import { characterFieldValues, characterLookText } from '../../../shared/character-facts.js'

// if (operation.action === 'source')
async function opSource(c) {
  let { operation, projects, project, trace, note } = c
  const saved = await projects.saveSource(project.id, operation.fields)
  note(`已保存资料：${saved.title}，${saved.durationSeconds} 秒，${saved.aspectRatio}`)
  note('时长、画幅或摘要一变，后面的内容已清空，等待重新生成')
  return trace
}

// if (operation.action === 'storyboard-text')
async function opStoryboardText(c) {
  let { operation, deps, projects, models, project, trace, note } = c
  project = await runStep('save', () => projects.save(project.id, current => ({ ...storyboardTextPatch(current, operation), activity: `shot-storyboard:${operation.track}` })), { target: `storyboard:${operation.track}` })
  const result = await (deps.reviewContent || reviewContent)({ project, stage: 'storyboard', shotId: operation.track, text: operation.text, route: (await loadModels(models)).story })
  checkContext.getStore().validation = result.failures
  await projects.save(project.id, { activity: null })
  note(result.passed ? '文本分镜已保存并通过自检' : `文本分镜已保存，自检未通过：${result.failures.join('；')}`)
  return trace
}

// if (operation.action === 'characters' || operation.action === 'scenes')
async function opCharacters(c) {
  let { operation, deps, projects, models, project, trace, note } = c
  const kind = operation.action
  await projects.save(project.id, { activity: kind, activityError: null })
  const group = await (deps.regenerateCardGroup || regenerateCardGroup)({ project, kind, route: (await loadModels(models)).story, review: operation.review, persist: async group => {
    const merged = preserveStoryAssets(project, { outline: project.plot.outline.content, characters: project.plot.characters, scenes: project.plot.scenes, [kind]: group, check: group.check })
    await projects.save(project.id, plotPatch(project, { [kind]: merged[kind] }))
  } })
  const merged = preserveStoryAssets(project, { outline: project.plot.outline.content, characters: project.plot.characters, scenes: project.plot.scenes, [kind]: group, check: group.check })
  checkContext.getStore().validation = group.check.failures
  await projects.save(project.id, { ...plotPatch(project, { [kind]: merged[kind] }), activity: null })
  note(`${kind === 'characters' ? '人物卡' : '场景卡'}已保存${group.check.passed ? '并通过自审' : '，自审未通过：' + group.check.failures.join('；')}`)
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
  const result = await (deps.reviewContent || reviewContent)({ project, stage: '场景文字编辑，仅审场景与大纲一致性，不要求重写大纲或人物卡', text: JSON.stringify(project.plot.scenes.items), route: (await loadModels(models)).story })
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
  const result = await (deps.reviewContent || reviewContent)({ project, stage: '人物文字编辑，仅审人物与大纲一致性，不要求重写大纲或场景卡', text: JSON.stringify(project.plot.characters.items), route: (await loadModels(models)).story })
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
  const result = await (deps.reviewContent || reviewContent)({ project, stage: 'outline', text: JSON.stringify({ outline, characters: project.plot.characters.items, scenes: project.plot.scenes.items }), route: (await loadModels(models)).story })
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
  note('依次生成并审核剧情大纲、提取人物角色、提取场景；每项独立调用模型，前项未通过则停止后项')
  const result = await (deps.generateStoryPackage || generateStoryPackage)({ route: (await loadModels(models)).story, project, persist: async result => {
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
  note(`剧情已保存：大纲、${merged.characters.items.length} 张角色卡、${merged.scenes.items.length} 张场景卡；${failures.length ? '自检未通过：' + failures.join('；') : '整包自检通过'}。镜头及后续内容已清空。`)
  return trace
}

// if (operation.action === 'shot-assets')
async function opShotAssets(c) {
  let { operation, projects, project, trace, note } = c
  const shot = project.shots?.items.find(item => item.id === operation.track)
  if (!shot) throw Object.assign(new Error('没有这一镜'), { status: 404 })
  const cast = (project.plot.characters?.items || []).filter(item => operation.characterIds?.includes(item.id)).map(item => item.name)
  const scene = (project.plot.scenes?.items || []).find(item => item.id === operation.sceneId)?.name || ''
  const patch = clearShotDownstream(project, 'storyboard', shot.id)
  await projects.save(project.id, { ...patch, shots: { ...patch.shots, items: patch.shots.items.map(item => item.id === shot.id ? { ...item, cast, scene, reference_images: operation.referenceIds || [], storyboard: { ...item.storyboard, stale: Boolean(item.storyboard.content), check: { ...item.storyboard.check, passed: null, failures: [] } } } : item) }, activity: null })
  note(`${shot.id} 素材关联已保存，请重新生成文本分镜`)
  return trace
}

// if (operation.action === 'shots')
async function opShots(c) {
  let { operation, deps, projects, models, project, submittedReview, trace, note } = c
  if (!canGenerate(project, 'shots')) throw Object.assign(new Error('请先写好场景卡，再写镜头表'), { status: 409 })
  project = await projects.save(project.id, { ...clearShotDownstream(project, 'shots'), activity: 'shots', activityError: null })
  const review = String(operation.review || '').trim()
  if (review.length > 2000) throw Object.assign(new Error('审核意见过长'), { status: 400 })
  note('按事件与空间连续性规划镜头表，每段不超过15秒')
  if (submittedReview) note(`审核意见：${submittedReview}`)
  const failures = feedbackOf(project, 'shots').check.failures
  if (failures.length) note(`自检未通过：${failures.join('；')}`)
  const shots = await (deps.generateShots || generateShots)({ route: (await loadModels(models)).story, project, review, persist: shots => projects.save(project.id, { shots }) })
  await projects.writeStep(project.id, 'shots', {
    shots,
    activity: null,
  })
  note(shots.check.passed ? `镜头表已通过自检，共 ${shots.items.length} 镜。` : `镜头表已写入，自检未通过：${shots.check.failures.join('；')}`)
  note('每秒指令需要在镜头表里单独生成')
  return trace
}

// if (operation.action === 'seconds')
async function opSeconds(c) {
  let { deps, projects, models, project, trace, note } = c
  const items = project.shots?.items || []
  if (!items.length) throw Object.assign(new Error('请先写好镜头表，再写每秒指令'), { status: 409 })
  project = await projects.save(project.id, { activity: 'seconds', activityError: null })
  note('整集一次生成每秒指令，整集独立自审')
  await (deps.generateAllSeconds || generateAllSeconds)({ route: (await loadModels(models)).story, project,
    persist: (shots, phase) => projects.save(project.id, current => {
      const patch = phase === 'draft' ? clearShotDownstream(current, 'seconds') : { shots: current.shots }
      patch.shots.seconds = shots.seconds
      patch.shots.items = patch.shots.items.map(shot => phase === 'draft' || shot.id === checkContext.getStore()?.target?.track ? { ...shot, seconds: shots.items.find(item => item.id === shot.id).seconds } : shot)
      return { ...patch, assembly: node('assembly'), activity: 'seconds' }
    }),
  })
  await projects.save(project.id, current => {
    const next = structuredClone(current)
    finish(next.shots.seconds, { passed: true, failures: [] })
    next.activity = null
    return next
  })
  note('每秒指令已写完')
  return trace
}

// if (operation.action === 'revise-shot')
async function opReviseShot(c) {
  let { operation, projects, models, project, trace, note } = c
  const review = String(operation.review || '').trim()
  if ((operation.generationMode === 'modify' && !review) || review.length > 2000) throw Object.assign(new Error('请先写下这一镜的审核意见'), { status: 400 })
  const track = String(operation.track || '')
  const items = project.shots?.items || []
  if (!items.some(item => item.id === track)) throw Object.assign(new Error('没有这一镜'), { status: 404 })
  if (!canGenerate(project, 'shots')) throw Object.assign(new Error('请先写好场景卡，再改镜头'), { status: 409 })
  project = await projects.save(project.id, { ...clearShotDownstream(project, 'shots', track), activity: `revise-shot:${track}`, activityError: null })
  note(`文件：server/generate/story.js`)
  note('函数：reviseShot')
  note(`重写 ${track}`)
  note(`审核意见：${review}`)
  const shots = await reviseShot({
    route: (await loadModels(models)).story, shotId: track, review,
    project, persist: shots => projects.save(project.id, { shots }),
  })
  await projects.writeStep(project.id, 'shots', { shots, activity: null })
  note(shots.check.passed ? `${track} 已重写，镜头表通过自检。` : `${track} 已重写，自检未通过：${shots.check.failures.join('；')}`)
  return trace
}

// if (operation.action === 'shot-seconds')
async function opShotSeconds(c) {
  let { operation, deps, projects, models, project, trace, note } = c
  const track = String(operation.track || '')
  const items = project.shots?.items || []
  if (!items.some(item => item.id === track)) throw Object.assign(new Error('没有这一镜'), { status: 404 })
  const review = String(operation.review || '').trim()
  if (review.length > 2000) throw Object.assign(new Error('审核意见过长'), { status: 400 })
  project = await projects.save(project.id, { ...clearShotDownstream(project, 'seconds', track), activity: `shot-seconds:${track}`, activityError: null })
  note('技能：每秒指令（skills/task/generate-seconds-instructions-skill.md）')
  note('函数：generateShotSeconds（server/generate/story.js）')
  note(`写 ${track} 的每一秒`)
  if (review) note(`审核意见：${review}`)
  const shots = await (deps.generateShotSeconds || generateShotSeconds)({
    route: (await loadModels(models)).story, shotId: track, project, review,
    persist: shots => projects.save(project.id, { shots }),
  })
  await projects.save(project.id, { shots, activity: null })
  const row = shots.items.find(item => item.id === track)
  note(`${track} 已生成指令原文，目标时长 ${row?.duration || 0} 秒`)
  return trace
}

// if (operation.action === 'shot-storyboard')
async function opShotStoryboard(c) {
  let { operation, deps, projects, models, project, trace, note } = c
  if (feedbackOf(project, `seconds:${operation.track}`).check.passed === false) throw Object.assign(new Error('这一镜每秒指令自检未通过，请先修正'), { status: 409 })
  const track = String(operation.track || '')
  if (!(project.shots?.items || []).some(item => item.id === track)) throw Object.assign(new Error('没有这一镜'), { status: 404 })
  if (!shotSecondsReady(project.shots.items.find(item => item.id === track))) throw Object.assign(new Error('请先写好这一镜的每秒指令'), { status: 409 })
  const review = String(operation.review || '').trim()
  if (review.length > 2000) throw Object.assign(new Error('审核意见过长'), { status: 400 })
  project = await projects.save(project.id, { ...clearShotDownstream(project, 'storyboard', track), activity: `shot-storyboard:${track}`, activityError: null })
  note('技能：文本分镜（skills/task/generate-text-storyboard-skill.md）')
  note('函数：generateShotStoryboard（server/generate/story.js）')
  note(`写 ${track} 的文本分镜。每秒指令原样进入面板，并检查身份、声音和参考图绑定`)
  if (review) note(`审核意见：${review}`)
  const storyboard = await (deps.generateShotStoryboard || generateShotStoryboard)({
    route: (await loadModels(models)).story, shotId: track, project, review,
  })
  await projects.save(project.id, { ...updateShotResults(project, 'storyboard', storyboard), assembly: node('assembly'), activity: null })
  note(`${track} 的分镜已写入。这一镜的铅笔分镜和成片已清空`)
  return trace
}

// if (operation.action === 'shot-boards')
async function opShotBoards(c) {
  let { deps, projects, models, project, trace, note } = c
  const ids = (project.shots?.items || []).map(item => item.id)
  if (!ids.length) throw Object.assign(new Error('请先写好镜头表'), { status: 409 })
  project = await projects.save(project.id, { activity: 'shot-boards', activityError: null })
  note('按镜头顺序生成所有分镜')
  await (deps.generateAllSeconds || generateAllSeconds)({ route: (await loadModels(models)).story, project,
    persist: (shots, phase) => projects.save(project.id, current => {
      const patch = phase === 'draft' ? clearShotDownstream(current, 'seconds') : { shots: current.shots }
      patch.shots.seconds = shots.seconds
      patch.shots.items = patch.shots.items.map(shot => phase === 'draft' || shot.id === checkContext.getStore()?.target?.track ? { ...shot, seconds: shots.items.find(item => item.id === shot.id).seconds } : shot)
      return { ...patch, assembly: node('assembly'), activity: 'shot-boards' }
    }),
  })
  const writeBoard = deps.generateShotStoryboard || generateShotStoryboard
  for (const track of ids) {
    let current = await projects.read(project.id)
    note('技能：文本分镜（skills/task/generate-text-storyboard-skill.md）')
    note('函数：generateShotStoryboard（server/generate/story.js）')
    note(`写 ${track} 的文本分镜。每秒指令原样进入面板，并检查身份、声音和参考图绑定`)
    await selectCheck(current, { action: 'shot-storyboard', track })
    const storyboard = await writeBoard({ route: (await loadModels(models)).story, shotId: track, project: current })
  await projects.save(project.id, { ...updateShotResults(current, 'storyboard', storyboard), assembly: node('assembly'), activity: 'shot-boards' })
    note(`${track} 的分镜已写入。这一镜的铅笔分镜和成片已清空`)
  }
  await projects.save(project.id, { activity: null })
  return trace
}

// if (operation.action === 'storyboard')
async function opStoryboard(c) {
  let { deps, projects, models, project, trace, note } = c
  if (!hasShots(project)) throw Object.assign(new Error('请先写好镜头表，再生成文本分镜'), { status: 409 })
  project = await projects.save(project.id, { activity: 'storyboard', activityError: null })
  const current = project
  if (current.shots.items.some(shot => !shotSecondsReady(shot) || shot.seconds.check.passed !== true || shot.seconds.stale)) throw Object.assign(new Error('请先生成整集每秒指令，并使每镜自审通过'), { status: 409 })
  await selectCheck(current, { action: 'storyboard' })
  note('按「文本分镜」技能生成全部分镜表，并审核原文剧情与素材关联')
  const storyboard = await (deps.generateStoryboard || generateStoryboard)({ route: (await loadModels(models)).story, project: current, beforeShot: track => projects.save(project.id, current => clearShotDownstream(current, 'storyboard', track)), persist: storyboard => projects.save(project.id, current => updateShotResults(current, 'storyboard', storyboard)) })
  await projects.writeStep(project.id, 'storyboard', { ...updateShotResults(await projects.read(project.id), 'storyboard', storyboard), activity: null })
  note(`文本分镜已写入，共 ${storyboard.length} 镜。铅笔分镜和成片已清空，等待重新生成`)
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
  'storyboard-text': { stage: 'episode', run: opStoryboardText },
  'characters': { stage: 'episode', run: opCharacters },
  'scenes': { stage: 'episode', run: opCharacters },
  'scene-text': { stage: 'episode', run: opSceneText },
  'character-text': { stage: 'episode', run: opCharacterText },
  'outline-text': { stage: 'episode', run: opOutlineText },
  'outline': { stage: 'episode', run: opOutline },
  'shot-assets': { stage: 'episode', run: opShotAssets },
  'shots': { stage: 'episode', run: opShots },
  'seconds': { stage: 'episode', run: opSeconds },
  'revise-shot': { stage: 'episode', run: opReviseShot },
  'shot-seconds': { stage: 'episode', run: opShotSeconds },
  'shot-storyboard': { stage: 'episode', run: opShotStoryboard },
  'shot-boards': { stage: 'episode', run: opShotBoards },
  'storyboard': { stage: 'episode', run: opStoryboard },
}
