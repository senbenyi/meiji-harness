import { characterImagesReady } from './character-costumes.js'
import { runStages, stageDependencies, textTargets, normalizeRunGoal } from './run-templates.js'
import { tailSteps } from '../server/models/tasks/run-model.js'
import { imageItems } from './library-images.js'
import { shotsReady, projectCharactersGate, hasCharacters } from './generation-gates.js'
import { shotSecondsReady } from './shot-timing.js'
import { shotReferences, cascadePreview } from './pipeline-cascade.js'
import { scriptFreshness, isAiCreation } from './script-assembly.js'
import { operationDeletes } from './operation-cascade.js'
import { libraryTarget, characterLibraryTarget } from './library-rules.js'
const passed = node => node?.check?.passed === true
const unique = entries => [...new Map(entries.map(value => [JSON.stringify(value), value])).values()]
const stageReady = (project, stage) => stage === 'summary' ? Boolean(project.summary?.content) && passed(project.summary) : stage === 'story' ? passed(project.plot?.outline) : stage === 'shots' ? shotsReady(project) : stage === 'seconds' ? Boolean(project.shots?.items.length) && project.shots.items.every(shot => shotSecondsReady(shot) && passed(shot.seconds)) : stage === 'film' ? Boolean(project.shots?.items.length) && project.shots.items.every(shot => shot.video?.content?.status === 'ready') : false

export function planRun(project, rawGoal, policy = {}) {
  const goal = normalizeRunGoal(rawGoal), steps = [], prereq = [], deletions = [], blockers = [], byKey = new Map(), stageTails = new Map()
  let nextId = 0
  const authorized = new Set(policy.authorizePrereq || []), stages = goal.from ? runStages.slice(runStages.indexOf(goal.from), runStages.indexOf(goal.to) + 1) : [goal.to]
  const add = (kind, target, definition, after = [], extra = {}) => {
    const key = `${kind}@${target}`
    if (byKey.has(key)) return byKey.get(key).id
    const step = { id: `step-${++nextId}`, key, kind, target, actor: definition.queue === null ? 'program' : 'model', queue: definition.queue ?? 'text', scope: definition.scope || 'episode', after: [...new Set(after)], origin: 'plan', input: { taskType: definition.taskType, operation: { action: definition.action, requirements: goal.requirements || '', ...(definition.operation || {}) } }, ...extra }
    if (definition.queue === null) step.queue = null
    steps.push(step); byKey.set(key, step); return step.id
  }
  const requireStage = (stage, after, required, prereqGoal = { to: stage }) => {
    if (stageTails.has(stage)) { after.push(...stageTails.get(stage)); return }
    if (stageReady(project, stage)) return
    const key = `${stage}@${prereqGoal.scope?.only || prereqGoal.scope?.tracks?.join(',') || prereqGoal.scope?.itemIds?.join(',') || 'all'}`
    const entry = { key, goal: prereqGoal, message: `需要先完成并审核${stage === 'summary' ? '摘要' : stage === 'story' ? '剧情资料' : stage === 'shots' ? '镜头表' : '每秒指令'}` }
    if (!prereq.some(item => item.key === key)) prereq.push(entry)
    if (authorized.has(key)) {
      const planned = planRun(project, prereqGoal, { ...policy, authorizePrereq: [...authorized].filter(value => value !== key) })
      for (const item of planned.prereq) if (!prereq.some(current => current.key === item.key)) prereq.push(item)
      const ids = new Map(planned.steps.map(item => [item.id, `step-${++nextId}`]))
      for (const item of planned.steps) { const existing = byKey.get(item.key); if (existing) ids.set(item.id, existing.id) }
      for (const item of planned.steps) if (!byKey.has(item.key)) { const mapped = { ...item, id: ids.get(item.id), after: item.after.map(id => ids.get(id)), origin: 'prereq' }; steps.push(mapped); byKey.set(mapped.key, mapped) }
      const tails = tailSteps(planned.steps).map(item => ids.get(item.id))
      after.push(...tails); stageTails.set(stage, tails); deletions.push(...planned.deletions)
    } else required.push(entry)
  }
  // regenerateOnly：未生成基稿的目标按重新生成处理，不带修改意见。
  const text = (target, definition, after = [], required = [], ready = false, operation = {}, regenerateOnly = false) => {
    const feedback = regenerateOnly ? '' : goal.feedback
    const mode = operation.characterSource === 'seconds' ? 'generate' : regenerateOnly && goal.mode === 'modify' ? 'regenerate' : target === 'script' && goal.mode === 'modify' ? 'generate' : goal.mode, kinds = mode === 'review' ? ['review'] : [mode === 'modify' ? 'revise' : 'generate', ...(policy.review === false && operation.characterSource !== 'seconds' ? [] : [mode === 'modify' && target !== 'script' ? 're_review' : 'review'])]
    ready = ready && !goal.draft && !required.length && after.every(id => steps.find(step => step.id === id)?.status === 'skipped')
    let tail
    for (const kind of kinds) {
      tail = add(kind, target, { ...definition, operation: { ...operation, ...(feedback ? { review: feedback, instruction: feedback } : {}) } }, tail ? [tail] : after, { ...(mode === 'generate' && ready ? { status: 'skipped' } : {}), input: { taskType: definition.taskType, operation: { action: definition.action, requirements: goal.requirements || '', ...operation, ...(feedback ? { review: feedback, instruction: feedback } : {}) }, required } })
    }
    return tail
  }
  const unknownCards = stages.includes('story') && !goal.scope.only && (goal.mode !== 'generate' || !stageReady(project, 'story'))
  const unknownShots = stages.includes('shots') && (goal.mode !== 'generate' || !shotsReady(project) || unknownCards)
  for (const stage of stages) {
    const after = [], required = [], tails = []
    if (goal.mode !== 'review') for (const dependency of policy.stageDependencies?.[stage] || stageDependencies[stage] || []) {
      // 库单图与剧情附带的补图（kinds）都紧跟在各自的来源之后执行，不再要求剧情阶段前置，避免补图再展开出剧情步骤。
      if (stage === 'images' && (goal.scope.library || goal.scope.kinds)) continue
      if (stage === 'film' && !stageTails.has('seconds')) continue // 成片前置逐镜检查，允许独立分支先完成。
      if (stage === 'film' && dependency === 'seconds' && !unknownShots && project.shots?.items.length) continue
      if (stage === 'film' && dependency === 'images') continue // 引用图片按镜头判断，不能等待未引用的卡片。
      requireStage(dependency, after, required)
    }
    if (stage === 'script-sync') {
      const sync = add('sync', 'script', { taskType: 'script-sync', action: 'script-sync', queue: 'text', scope: 'project' }, after)
      tails.push(add('wait_script_confirm', 'script', { queue: null, scope: 'project' }, [sync]))
    } else if (stage === 'story') {
      const chosen = [goal.scope.only || 'outline'], roots = new Map()
      for (const target of chosen) {
        const deps = [...after], needs = [...required]
        if (target !== 'outline' && roots.has('outline')) deps.push(roots.get('outline'))
        else if (target !== 'outline' && !passed(project.plot?.outline)) requireStage('story', deps, needs, { to: 'story', scope: { only: 'outline' } })
        // 人物在大纲审核通过后提取并并入项目角色库；不再自动提取场景和道具。
        const ready = passed(project.plot?.[target]) && (target !== 'characters' || hasCharacters(project))
        roots.set(target, text(target, textTargets[target], deps, needs, ready, {}, target !== 'outline' && !goal.scope.only))
        // 人物提取通过后复用已有角色图：运行时展开，仅缺图人物生图并直接入库使用；
        // 自动保存，不等待人工确认，也不作为人物文字阶段的末端，镜头表等下游不等图片。
        // 即使文字已通过，也检查图片是否完整，失败后可补齐图片。
        if (target === 'characters' && goal.mode !== 'review') add('expand', `images:${target}`, { queue: null }, [roots.get(target)], { branch: true, input: { goal: { to: 'images', mode: 'generate', scope: { kinds: [target] } }, policy: { autoSaveImages: true }, required: [] } })
      }
      tails.push(...roots.values())
      if (chosen.includes('outline') && goal.mode !== 'review') {
        const parent = roots.get('outline'), skipped = steps.find(step => step.id === parent)?.status === 'skipped' && project.summary?.outlineRevision === project.plot.outline.revision
        add('generate', 'summary', textTargets.summary, [parent], { branch: true, optional: true, ...(skipped ? { status: 'skipped' } : {}) })
      }
    } else if (stage === 'project-characters') {
      if (!projectCharactersGate(project).allowed) blockers.push({ message: projectCharactersGate(project).reason })
      const extracted = text('project-characters', textTargets['project-characters'], after, required)
      tails.push(extracted)
      if (goal.mode !== 'review') tails.push(add('expand', 'images:project-characters', { queue: null, scope: 'project' }, [extracted], { input: { goal: { to: 'images', mode: 'generate', scope: { kinds: ['characters'] } }, policy: { projectCharacters: true, autoSaveImages: true }, required: [] } }))
    } else if (['summary', 'project-summary', 'script-revise'].includes(stage)) {
      const target = stage === 'script-revise' ? 'script' : stage
      let last = stage === 'summary'
        ? add('generate', 'summary', textTargets.summary, after, { input: { taskType: 'summary', operation: { action: 'episode-generate' }, required } })
        : text(target, textTargets[target], after, required, stage === 'project-summary' ? !scriptFreshness(project).summaryNeedsUpdate && passed(project.summary) : false,
          { ...(stage === 'script-revise' ? { fromEpisode: goal.scope.fromEpisode === undefined ? undefined : goal.scope.fromEpisode - 1, requirements: goal.feedback || goal.requirements || '' } : {}) })
      if (stage === 'script-revise') last = add('wait_script_confirm', 'script', { queue: null, scope: 'project' }, [last])
      tails.push(last)
    } else if (stage === 'shots') {
      if (goal.scope.tracks) for (const track of goal.scope.tracks) {
        if (!project.shots?.items.some(shot => shot.id === track)) blockers.push({ message: `镜头 ${track} 不存在` })
        tails.push(text(`shots:${track}`, { ...textTargets.shots, action: 'revise-shot' }, after, required, false, { track }))
      } else tails.push(text('shots', textTargets.shots, after, required, shotsReady(project)))
    } else if (stage === 'images') {
      if (policy.projectCharacters && !goal.scope.library) {
        const seen = new Set()
        for (const card of project.projectCharacters?.items || []) {
          if (card.presence === 'voice') continue
          const found = characterLibraryTarget(project, card)
          if (!found) { blockers.push({ message: `角色尚未入库：${card.name}` }); continue }
          if (seen.has(found.entry.id)) continue
          seen.add(found.entry.id)
          const library = { kind: 'characters', id: found.entry.id, variantId: found.variant.id }
          tails.push(add('expand', `images:${found.variant.id}`, { queue: null, scope: 'project' }, after, { input: { goal: { to: 'images', mode: 'generate', scope: { library } }, policy: { autoSaveImages: true }, required: [] } }))
        }
      } else if (goal.scope.library) {
        const library = goal.scope.library, found = libraryTarget(project, library.kind, { libraryId: library.id, variantId: library.variantId })
        if (!found) blockers.push({ message: '库图片变体不存在' })
        else {
          const ready = library.kind === 'characters' ? characterImagesReady(found.variant.fields.costumes, found.variant.image.content) : Boolean(found.variant.image.content?.assetId || found.variant.image.content?.localPath || found.variant.image.content?.url), pending = Object.values(project.pendingImages || {}).some(item => item.variantId === library.variantId)
          const autoSave = policy.autoSaveImages && library.kind === 'characters'
          const operation = { action: 'library-image', libraryKind: library.kind, libraryId: library.id, variantId: library.variantId, ...(autoSave ? { autoSave: true } : {}) }, target = `image:${library.variantId}`
          const image = add('image', target, { taskType: 'library-image', action: 'library-image', queue: 'image', scope: 'project', operation }, after, goal.mode === 'generate' && (ready || !autoSave && pending) ? { status: 'skipped' } : {})
          if (autoSave) tails.push(image)
          else tails.push(add('wait_confirm', target, { queue: null, scope: 'project' }, [image], { input: { library }, ...(ready && !pending && goal.mode === 'generate' ? { status: 'skipped' } : {}) }))
        }
      } else if (unknownCards || !project.plot?.characters?.items.length && !project.plot?.scenes?.items.length && required.length) tails.push(add('expand', 'images', { queue: null }, after, { input: { goal: { ...goal, from: undefined, to: 'images', scope: {} }, required } }))
      else {
        let entries = []
        try { entries = imageItems(project, project, goal.scope.itemIds).filter(entry => !goal.scope.kinds || goal.scope.kinds.includes(entry.kind)) } catch (error) { blockers.push({ message: error.message }) }
        const seen = new Set()
        for (const entry of entries) {
          const identity = entry.card.ref ? `${entry.card.ref.libraryId}/${entry.card.ref.variantId}` : entry.card.id
          if (!policy.autoSaveImages && seen.has(identity)) continue
          seen.add(identity)
          const target = `image:${entry.card.id}`, definition = { taskType: entry.kind === 'characters' ? 'character-image' : entry.kind === 'scenes' ? 'scene-image' : 'prop-image', action: 'image', queue: 'image', scope: entry.card.ref ? 'project' : 'episode', operation: { itemId: entry.card.id, generationMode: 'regenerate' } }
          const image = add('image', target, definition, after, { ...(goal.mode === 'generate' && (entry.ready || !policy.autoSaveImages && entry.pending) ? { status: 'skipped' } : {}), input: { taskType: definition.taskType, operation: { action: 'image', itemId: entry.card.id, generationMode: goal.mode === 'modify' ? 'modify' : 'regenerate', review: goal.feedback || '', requirements: goal.requirements || '', ...(goal.image || {}), ...(policy.autoSaveImages && entry.kind === 'characters' ? { autoSave: true } : {}) }, required } })
          // 人物任务自动入库；其他明确不等待确认的图片仍只保存候选。
          if (policy.autoSaveImages && entry.kind === 'characters' || policy.imageConfirm === false) tails.push(image)
          else tails.push(add('wait_confirm', target, { queue: null }, [image], { ...(entry.ready && goal.mode === 'generate' ? { status: 'skipped' } : {}), input: { itemId: entry.card.id } }))
        }
      }
    } else if (stage === 'seconds' || stage === 'film') {
      if (unknownShots || !project.shots?.items.length) {
        if (stage === 'film' && !stageTails.has('seconds')) requireStage('seconds', after, required)
        tails.push(add('expand', stage, { queue: null }, after, { input: { goal: { ...goal, from: undefined, to: stage, scope: { tracks: goal.scope.tracks } }, required } }))
      }
      else {
        const items = project.shots?.items || []
        // 整集修改从第一个未通过或缺失的镜头做到末镜，前面已通过的镜头不因补充意见重复生成；
        // 全部已通过时没有中断点，整集意见作用于全部镜头，避免提交意见后什么都不做。
        const firstIncomplete = items.findIndex(shot => !shotSecondsReady(shot) || !passed(shot.seconds))
        const resume = stage === 'seconds' && goal.mode === 'modify' && !goal.scope.tracks ? Math.max(0, firstIncomplete) : 0
        const tracks = goal.scope.tracks || items.slice(resume).map(shot => shot.id)
        if (!tracks.length) blockers.push({ message: '没有可执行的镜头；请授权生成镜头表前置' })
        let previous = null
        for (const track of tracks) {
          const shot = items.find(item => item.id === track)
          if (!shot) { blockers.push({ message: `镜头 ${track} 不存在` }); continue }
          const deps = [...after], needs = [...required]
          if (stage === 'seconds') {
            if (previous) deps.push(previous)
            // 没有旧稿的镜头无从修订，改为生成。
            previous = text(`seconds:${track}`, textTargets.seconds, deps, needs, shotSecondsReady(shot) && passed(shot.seconds), { track }, !shot.seconds?.content); tails.push(previous)
            // 前镜更新会清除后镜旧稿：修订步骤带上规划时的本镜基稿，逐镜仍以各自旧稿为基础修改。
            const revise = byKey.get(`revise@seconds:${track}`)
            if (revise && shot.seconds?.content) revise.input.baseNode = structuredClone(shot.seconds)
          } else {
            const seconds = byKey.get(`re_review@seconds:${track}`) || byKey.get(`review@seconds:${track}`) || byKey.get(`generate@seconds:${track}`)
            if (seconds) deps.push(seconds.id)
            if (!shotSecondsReady(shot) || !passed(shot.seconds)) requireStage('seconds', deps, needs, { to: 'seconds', scope: { tracks: [track] } })
            for (const entry of goal.parts === 'storyboard' ? [] : imageItems(project, project)) if (entry.kind !== 'characters' && shotReferences(shot, entry.card.id, entry.card.name)) {
              const wait = byKey.get(`wait_confirm@image:${entry.card.id}`)
              if (wait) deps.push(wait.id)
              else if (!entry.ready) {
                const requirement = { key: `images@${entry.card.id}`, goal: { to: 'images', scope: { itemIds: [entry.card.id] } }, message: `确认 ${entry.card.name} 的图片` }
                prereq.push(requirement)
                if (authorized.has(requirement.key)) { const prior = stageTails.get('images'); stageTails.delete('images'); requireStage('images', deps, needs, requirement.goal); if (prior) stageTails.set('images', prior) }
                else needs.push(requirement)
              }
            }
            // 尾帧衔接：同一任务内后一镜等前一镜尾帧完成后再开始，前一镜未完成时其后各镜都等待；已有尾帧引用的来源镜同样先完成。
            const source = shot.storyboard?.content?.tailReference?.sourceShotId, before = items[items.indexOf(shot) - 1]?.id
            for (const id of [before, source]) { const predecessor = id && byKey.get(`tail@film:${id}`); if (predecessor) deps.push(predecessor.id) }
            let last
            const kinds = goal.parts === 'storyboard' ? ['storyboard'] : goal.parts === 'video' ? ['video', 'tail'] : goal.parts === 'tail' ? ['tail'] : ['storyboard', 'video', 'tail']
            for (const kind of kinds) {
              const fresh = policy.freshness?.[track] || {}, videoDone = fresh.video ?? shot.video?.content?.status === 'ready'
              // 视频已完成的镜头不重编分镜：重编会级联删除该视频，而视频步骤已按就绪跳过。
              const ready = kind === 'storyboard' ? Boolean(fresh.storyboard) || !goal.parts && videoDone : kind === 'video' ? videoDone : fresh.tail ?? (passed(shot.tailFrame) && Boolean(shot.tailFrame?.content?.localPath) && shot.tailFrame.content.sourceVideoFile === shot.video?.content?.file)
              last = add(kind, kind === 'storyboard' ? `storyboard:${track}` : `film:${track}`, { taskType: kind === 'storyboard' ? 'storyboard-prompt' : 'video', action: kind === 'storyboard' ? 'shot-storyboard' : 'film', queue: kind === 'video' ? 'video' : null, operation: { track, parts: kind === 'video' ? 'video' : kind === 'tail' ? 'tail' : 'storyboard', runVideoOnly: kind === 'video' } }, last ? [last, ...deps] : deps, { ...(goal.mode === 'generate' && ready ? { status: 'skipped' } : {}) })
              byKey.get(`${kind}@${kind === 'storyboard' ? `storyboard:${track}` : `film:${track}`}`).input.required = needs
            }
            tails.push(last)
          }
        }
      }
    } else if (stage === 'assemble') tails.push(add('assemble', 'assembly', { taskType: 'save', action: 'assemble', queue: null }, after, { input: { taskType: 'save', directAction: 'assemble', operation: { action: 'assemble' }, required } }))
    stageTails.set(stage, tails)
  }
  for (const stage of stages) {
    const action = stage === 'shots' ? 'shot-table' : stage
    if (['summary', 'story', 'shots', 'seconds', 'film'].includes(stage) && goal.mode !== 'review') {
      const scope = goal.scope.tracks || [null]
      for (const track of scope) deletions.push(...operationDeletes(project, { action, episodeId: project.episodeId || project.id, mode: goal.mode, draft: goal.draft, only: goal.scope.only, track, parts: goal.parts }))
    }
  }
  // generate 只执行未满足的目标；已跳过的模板不删除已保存资料。
  const allSkipped = steps.length && steps.every(step => step.status === 'skipped')
  return { goal, steps, prereq: unique(prereq), deletions: allSkipped ? [] : unique(deletions), blockers: unique(blockers) }
}

export function invalidatedRunTargets(project, change) {
  return unique(cascadePreview(project, change).map(item => item.track ? `${item.kind === 'video' || item.kind === 'tailFrame' ? 'film' : item.kind}:${item.track}` : item.kind === 'assembly' ? 'assembly' : item.kind))
}

export function mergeRunPlans(plans) {
  const steps = [], existing = new Map()
  let next = 0
  for (const plan of plans) {
    const ids = new Map()
    for (const step of plan.steps) ids.set(step.id, existing.get(step.key)?.id || `step-${++next}`)
    for (const step of plan.steps) if (!existing.has(step.key)) {
      const mapped = { ...step, id: ids.get(step.id), after: step.after.map(id => ids.get(id)) }
      steps.push(mapped); existing.set(mapped.key, mapped)
    }
  }
  return { steps, prereq: unique(plans.flatMap(plan => plan.prereq)), deletions: unique(plans.flatMap(plan => plan.deletions)), blockers: unique(plans.flatMap(plan => plan.blockers)) }
}
