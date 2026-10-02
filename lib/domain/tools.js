import { randomUUID } from 'node:crypto'
import { attemptList, canvasReadModel, diagnosticsReadModel, projectSummary, reviewQueue } from './read-models.js'
import { compilePromptSnapshot } from '../prompts/compiler.js'

const output = {
  schema: { type: 'object', properties: { ok: { type: 'boolean' }, json: { type: 'string' }, error: { type: 'string' } } },
  render: (_args, value) => [{ type: 'text', text: value.ok ? value.json : `失败：${value.error}` }],
}

const string = (description) => ({ type: 'string', description })
const integer = (description) => ({ type: 'integer', description })

function params(properties, required = []) {
  return { type: 'object', properties, required }
}

function jsonValue(value, fallback = {}) {
  if (!value) return fallback
  if (typeof value === 'object') return value
  const parsed = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object') throw new Error('json must decode to an object')
  return parsed
}

function ok(data) { return { ok: true, json: JSON.stringify(data), error: '' } }
function fail(error) { return { ok: false, json: '', error: error?.message || String(error) } }

function writeTool(service, { name, description, command, properties = {}, required = [], payload }) {
  return {
    name,
    description,
    parameters: params({ projectId: string('Project id'), revision: integer('Expected Project revision'), commandId: string('Stable idempotency key'), ...properties }, ['projectId', 'revision', ...required]),
    output,
    async execute(args) {
      try {
        const commandPayload = payload ? payload(args) : jsonValue(args.json)
        const result = await service.execute({
          projectId: args.projectId,
          commandId: args.commandId || randomUUID(),
          expectedRevision: args.revision,
          type: command,
          payload: commandPayload,
        })
        return ok({ revision: result.project.revision, ...result.output })
      } catch (error) { return fail(error) }
    },
  }
}

function readTool({ name, description, properties = {}, required = [], read }) {
  return {
    name, description,
    parameters: params({ projectId: string('Project id'), ...properties }, ['projectId', ...required]),
    output,
    async execute(args) { try { return ok(await read(args)) } catch (error) { return fail(error) } },
  }
}

export function makeProjectTools(service, features = {}) {
  const tools = [{
    name: 'studio_project_create',
    description: '创建独立于 Harness Session 的短剧 Project。',
    parameters: params({ title: string('Project title'), productionSpec: string('ProductionSpec JSON'), commandId: string('Stable idempotency key'), workspaceId: string('Optional workspace id') }, ['title']),
    output,
    async execute(args, exec) {
      try {
        const result = await service.createProject({ commandId: args.commandId || randomUUID(), payload: { title: args.title, productionSpec: jsonValue(args.productionSpec) } })
        if (features.onProjectCreated) await features.onProjectCreated(result.project, args, exec)
        return ok({ projectId: result.project.id, revision: result.project.revision })
      } catch (error) { return fail(error) }
    },
  }]

  tools.push(readTool({
    name: 'studio_project_get', description: '读取 Project、画布或诊断投影。',
    properties: { projection: string('project|canvas|diagnostics|summary') },
    read: async ({ projectId, projection = 'project' }) => {
      const project = await service.getProject(projectId)
      if (projection === 'canvas') return canvasReadModel(project)
      if (projection === 'diagnostics') return diagnosticsReadModel(project)
      if (projection === 'summary') return projectSummary(project)
      return project
    },
  }))
  if (features.promptSnapshots !== false) {
    tools.push(readTool({
      name: 'studio_prompt_preview', description: '只读编译镜头最终提示词、引用和输入快照；不会创建 Attempt 或提交生成。',
      properties: {
        shotId: string('Shot id'), capability: string('Capability'), tier: string('Optional tier'),
        prompt: string('Optional prompt override'), negativePrompt: string('Optional negative prompt override'),
        parameters: string('Generation parameters JSON'), workflowFingerprint: string('Verified workflow fingerprint'),
      },
      required: ['shotId', 'capability'],
      read: async (a) => compilePromptSnapshot({
        project: await service.getProject(a.projectId), shotId: a.shotId, capability: a.capability,
        tier: a.tier || 'default', prompt: a.prompt, negativePrompt: a.negativePrompt,
        parameters: jsonValue(a.parameters), workflowFingerprint: a.workflowFingerprint || '',
      }),
    }))
  }

  tools.push(writeTool(service, { name: 'studio_project_update_spec', description: '更新制作规格。', command: 'updateProductionSpec', properties: { spec: string('ProductionSpec patch JSON') }, required: ['spec'], payload: (a) => jsonValue(a.spec) }))
  tools.push(writeTool(service, { name: 'studio_story_bible_write', description: '写入故事圣经并失效下游。', command: 'upsertStoryBible', properties: { storyBible: string('StoryBible JSON') }, required: ['storyBible'], payload: (a) => jsonValue(a.storyBible) }))
  tools.push(writeTool(service, { name: 'studio_character_upsert', description: '写入角色或角色阶段状态。', command: 'upsertCharacter', properties: { character: string('Character JSON') }, required: ['character'], payload: (a) => jsonValue(a.character) }))
  tools.push(writeTool(service, { name: 'studio_location_upsert', description: '写入场景设定。', command: 'upsertLocation', properties: { location: string('Location JSON') }, required: ['location'], payload: (a) => jsonValue(a.location) }))
  tools.push(writeTool(service, { name: 'studio_episode_upsert', description: '写入剧集。', command: 'upsertEpisode', properties: { episode: string('Episode JSON') }, required: ['episode'], payload: (a) => jsonValue(a.episode) }))
  tools.push(writeTool(service, { name: 'studio_shot_upsert', description: '写入七列镜头字段。', command: 'upsertShot', properties: { shot: string('Shot JSON') }, required: ['shot'], payload: (a) => jsonValue(a.shot) }))

  tools.push(readTool({
    name: 'studio_shot_list', description: '读取镜头队列。', properties: { episodeId: string('Optional episode id'), status: string('Optional status') },
    read: async (a) => Object.values((await service.getProject(a.projectId)).shots).filter((shot) => (!a.episodeId || shot.episodeId === a.episodeId) && (!a.status || shot.status === a.status)),
  }))
  tools.push(readTool({
    name: 'studio_shotlist_validate', description: '检查镜头时长、引用、连续性和权利门。', properties: { episodeId: string('Episode id') }, required: ['episodeId'],
    read: async (a) => {
      const project = await service.getProject(a.projectId)
      const shots = Object.values(project.shots).filter((shot) => shot.episodeId === a.episodeId)
      const issues = []
      if (!shots.length) issues.push({ code: 'empty-shotlist' })
      for (const shot of shots) {
        if (!(Number(shot.duration) > 0)) issues.push({ code: 'missing-duration', shotId: shot.id })
        for (const dep of shot.dependsOn || []) if (!project.shots[dep] && !project.assets[dep]) issues.push({ code: 'missing-reference', shotId: shot.id, referenceId: dep })
      }
      return { valid: issues.length === 0, issues }
    },
  }))
  tools.push(readTool({
    name: 'studio_attempt_list', description: features.attemptDiagnostics === false ? '读取 Attempt 历史。' : '读取 Attempt 历史、错误分类、重复计费风险和恢复建议。',
    properties: { shotId: string('Optional shot id'), status: string('Optional status') },
    read: async (a) => features.attemptDiagnostics === false
      ? Object.values((await service.getProject(a.projectId)).attempts).filter((item) => (!a.shotId || item.shotId === a.shotId) && (!a.status || item.status === a.status))
      : attemptList(await service.getProject(a.projectId), a),
  }))
  tools.push(writeTool(service, { name: 'studio_attempt_cancel', description: '取消非终态生成尝试。', command: 'cancelGenerationAttempt', properties: { attemptId: string('Attempt id'), reason: string('Reason') }, required: ['attemptId'], payload: (a) => ({ attemptId: a.attemptId, reason: a.reason }) }))
  tools.push(writeTool(service, { name: 'studio_attempt_recover', description: '显式恢复不确定或中断的生成尝试。', command: 'recoverGenerationAttempt', properties: { attemptId: string('Attempt id'), decision: string('resume|fail|cancel'), externalRef: string('Confirmed external ref'), reason: string('Reason') }, required: ['attemptId', 'decision'], payload: (a) => ({ attemptId: a.attemptId, decision: a.decision, externalRef: a.externalRef, reason: a.reason }) }))
  tools.push(readTool({ name: 'studio_review_queue', description: '读取待人工审核队列。', read: async (a) => reviewQueue(await service.getProject(a.projectId)) }))
  tools.push(writeTool(service, { name: 'studio_review_decide', description: '记录人工审核决定。', command: 'recordReviewDecision', properties: { reviewTaskId: string('ReviewTask id'), decision: string('approved|rejected'), reason: string('Reason'), answerer: string('Human answerer') }, required: ['reviewTaskId', 'decision'], payload: (a) => ({ reviewTaskId: a.reviewTaskId, decision: a.decision, reason: a.reason, answerer: a.answerer }) }))
  tools.push(writeTool(service, {
    name: 'studio_review_batch_decide', description: '批量记录多个审核决定（单次调用处理多条）。',
    command: 'batchRecordReviewDecisions',
    properties: { decisions: string('JSON array of {reviewTaskId, decision, reason?, answerer?}'), answerer: string('Default answerer') },
    required: ['decisions'],
    payload: (a) => ({ decisions: JSON.parse(a.decisions), answerer: a.answerer }),
  }))
  tools.push(readTool({
    name: 'studio_timeline_assembly_check', description: '预检 timeline 组装就绪度：列出所有未批准的资产及其所属镜头。',
    properties: { episodeId: string('Episode id') }, required: ['episodeId'],
    read: async (a) => {
      const project = await service.getProject(a.projectId)
      const shots = Object.values(project.shots).filter((s) => s.episodeId === a.episodeId)
      const issues = []
      for (const shot of shots) {
        const approvedAsset = shot.approvedAssetId && project.assets[shot.approvedAssetId]?.status === 'approved'
        if (!approvedAsset) {
          const latestReview = Object.values(project.reviewTasks).find((t) => shot.assetIds?.includes(t.targetId) && ['pending', 'automated_check', 'awaiting_human'].includes(t.status))
          issues.push({ shotId: shot.id, shotTitle: shot.title, status: shot.status, approvedAssetId: shot.approvedAssetId || null, pendingReviewTaskId: latestReview?.id || null })
        }
      }
      return { ready: issues.length === 0, totalShots: shots.length, readyShots: shots.length - issues.length, issues }
    },
  }))
  tools.push(writeTool(service, { name: 'studio_timeline_assemble', description: '用批准资产创建 Timeline revision。', command: 'assembleTimeline', properties: { episodeId: string('Episode id'), approvedAssetIds: string('JSON array of approved asset ids'), settings: string('Timeline settings JSON') }, required: ['episodeId', 'approvedAssetIds'], payload: (a) => ({ episodeId: a.episodeId, assetIds: JSON.parse(a.approvedAssetIds), settings: jsonValue(a.settings) }) }))
  tools.push(readTool({ name: 'studio_timeline_get', description: '读取 Timeline。', properties: { timelineId: string('Timeline id') }, required: ['timelineId'], read: async (a) => (await service.getProject(a.projectId)).timelines[a.timelineId] || null }))
  tools.push(writeTool(service, { name: 'studio_deliverable_export', description: '规划交付导出任务。', command: 'planDeliverable', properties: { timelineId: string('Timeline id'), preset: string('Export preset') }, required: ['timelineId'], payload: (a) => ({ timelineId: a.timelineId, preset: a.preset }) }))
  tools.push(readTool({ name: 'studio_deliverable_get', description: '读取 Deliverable 状态与质量报告。', properties: { deliverableId: string('Deliverable id') }, required: ['deliverableId'], read: async (a) => (await service.getProject(a.projectId)).deliverables[a.deliverableId] || null }))
  tools.push(writeTool(service, { name: 'studio_rights_record', description: '记录成年、同意或许可证证据引用。', command: 'recordRights', properties: { rights: string('RightsRecord JSON without sensitive original') }, required: ['rights'], payload: (a) => jsonValue(a.rights) }))
  tools.push(readTool({ name: 'studio_rights_list', description: '读取权利覆盖和缺口，不回显证据原件。', read: async (a) => Object.values((await service.getProject(a.projectId)).rightsRecords).map(({ evidenceAssetIds, ...record }) => ({ ...record, evidenceCount: evidenceAssetIds?.length || 0 })) }))

  tools.push(readTool({
    name: 'studio_shot_retry_candidates', description: '列出所有被拒后可重新生成的镜头，含拒绝原因和最近 attempt 信息。',
    properties: { episodeId: string('Optional episode filter') },
    read: async (a) => {
      const project = await service.getProject(a.projectId)
      return Object.values(project.shots)
        .filter((s) => (!a.episodeId || s.episodeId === a.episodeId) && s.status === 'ready' && s.assetIds?.length)
        .map((s) => {
          const lastReview = Object.values(project.reviewTasks).filter((t) => s.assetIds.includes(t.targetId) && t.status === 'rejected').pop()
          const lastAttempt = (s.attemptIds || []).map((id) => project.attempts[id]).filter(Boolean).pop()
          return { shotId: s.id, title: s.title, episodeId: s.episodeId, rejectedReviewTaskId: lastReview?.id || null, rejectionReason: lastReview ? project.reviewDecisions[lastReview.decisionId]?.reason || null : null, lastAttemptId: lastAttempt?.id || null, lastAttemptStatus: lastAttempt?.status || null }
        })
    },
  }))

  tools.push(readTool({
    name: 'studio_shot_state_info', description: '返回镜头状态机定义：每个状态的含义、可生成性和合法转移。',
    read: async () => ({
      states: {
        planned: { description: '初始状态，尚未就绪', canGenerate: false, nextStates: ['ready', 'blocked'] },
        ready: { description: '可以生成', canGenerate: true, nextStates: ['generating', 'blocked'] },
        generating: { description: '生成中', canGenerate: false, nextStates: ['review', 'ready', 'blocked'] },
        review: { description: '待审核', canGenerate: false, nextStates: ['approved', 'rejected', 'blocked'] },
        rejected: { description: '审核拒绝，可重新生成', canGenerate: true, nextStates: ['ready', 'blocked'] },
        approved: { description: '已批准', canGenerate: false, nextStates: ['assembled', 'invalidated', 'blocked'] },
        invalidated: { description: '上游变更导致失效，可重新生成', canGenerate: true, nextStates: ['ready', 'blocked'] },
        assembled: { description: '已组装进 timeline', canGenerate: false, nextStates: ['invalidated'] },
        blocked: { description: '被阻断', canGenerate: false, nextStates: ['ready'] },
      },
    }),
  }))

  tools.push(readTool({
    name: 'studio_find_orphaned_references', description: '查找所有引用了已删除/失效实体的镜头。',
    read: async (a) => {
      const project = await service.getProject(a.projectId)
      const orphans = []
      for (const shot of Object.values(project.shots)) {
        for (const binding of shot.referenceBindings || []) {
          const entityId = binding.entityId
          const assetId = binding.assetId
          if (entityId && !project.characters[entityId] && !project.locations[entityId]) orphans.push({ shotId: shot.id, shotTitle: shot.title, missingEntityId: entityId, bindingRole: binding.role || null })
          if (assetId && !project.assets[assetId]) orphans.push({ shotId: shot.id, shotTitle: shot.title, missingAssetId: assetId, bindingRole: binding.role || null })
        }
      }
      return { count: orphans.length, orphans }
    },
  }))

  return tools
}
