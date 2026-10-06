import { createHash } from 'node:crypto'

const output = {
  schema: { type: 'object', properties: { ok: { type: 'boolean' }, json: { type: 'string' }, error: { type: 'string' }, code: { type: 'string' }, retryable: { type: 'boolean' }, action: { type: 'string' } } },
  render: (_args, value) => [{ type: 'text', text: value.ok ? value.json : JSON.stringify({ ok: false, error: value.error, code: value.code, retryable: value.retryable, action: value.action }) }],
}

const string = (description) => ({ type: 'string', description })
const object = (description) => ({ type: 'object', description, additionalProperties: true })
const sourceRefs = {
  type: 'array',
  description: 'Optional source references; omitted values are derived from the current Project sources',
  items: {
    type: 'object',
    properties: { sourceId: { type: 'string' }, contentHash: { type: 'string' } },
    required: ['sourceId', 'contentHash'],
  },
}

function result(value) { return { ok: true, json: JSON.stringify(value), error: '' } }
function failure(error) {
  const message = error?.message || String(error)
  const conflict = /revision|conflict|lease/i.test(message)
  return {
    ok: false, json: '', error: message,
    code: conflict ? 'CONFLICT' : 'INVALID_REQUEST', retryable: conflict,
    action: conflict ? 'read latest project summary once, then replay the same logical command id' : 'fix the reported input; do not repeat this call unchanged',
  }
}
function settleFailure(error) {
  const value = failure(error)
  if (!value.retryable) {
    const terminal = new Error(value.error)
    terminal.code = value.code
    terminal.retryable = false
    throw terminal
  }
  return value
}
function structured(value, label) {
  if (value && typeof value === 'object') return value
  if (typeof value === 'string') return JSON.parse(value)
  throw new Error(`${label} must be a structured JSON value`)
}

function commandKey(projectId, kind, payload) {
  const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16)
  return `studio:${projectId}:${kind}:${digest}`
}

export function makeScriptDevelopmentTools({ projectService, sourceServiceFor, sourceTextFor }) {
  const submit = (name, description, kind) => ({
    name, description,
    parameters: {
      type: 'object',
      properties: {
        projectId: string('Project id'), revision: { type: 'integer', description: 'Expected Project revision' },
        proposalId: string('Optional stable proposal id'), sourceRefs,
        payload: object('Structured proposal payload; pass an object, never a JSON string'), commandId: string('Stable idempotency key'),
        autoApprove: { type: 'boolean', description: 'Approve and materialize this proposal in the same tool call' },
        answerer: string('Approval actor when autoApprove is true'),
      },
      required: ['projectId', 'revision', 'payload'],
    },
    output,
    async execute(args) {
      try {
        const project = await projectService.getProject(args.projectId)
        const proposalPayload = structured(args.payload, 'payload')
        const resolvedSourceRefs = args.sourceRefs
          ? structured(args.sourceRefs, 'sourceRefs')
          : Object.values(project.sourceDocuments).map(({ id: sourceId, contentHash }) => ({ sourceId, contentHash }))
        const commandId = args.commandId || commandKey(args.projectId, kind, proposalPayload)
        const response = await projectService.execute({
          projectId: args.projectId, commandId, expectedRevision: args.revision,
          type: 'submitDevelopmentProposal',
          payload: {
            proposalId: args.proposalId,
            kind,
            sourceRefs: resolvedSourceRefs,
            payload: proposalPayload,
          },
          actor: 'script-development',
        })
        if (!args.autoApprove) return result({ revision: response.project.revision, ...response.output })
        const approved = await projectService.execute({
          projectId: args.projectId,
          commandId: `${commandId}:approve`,
          expectedRevision: response.project.revision,
          type: 'recordReviewDecision',
          payload: {
            reviewTaskId: response.output.reviewTaskId,
            decision: 'approved',
            reason: 'auto-approved by production workflow',
            answerer: args.answerer || 'studio-auto-approve',
          },
          actor: 'script-development',
        })
        return result({ revision: approved.project.revision, ...response.output, approved: true })
      } catch (error) { return settleFailure(error) }
    },
  })

  return [
    {
      name: 'studio_source_import', description: '导入不可变纯文本源文；可直接传工作区内的 TXT/Markdown 文件路径，避免把整书正文放进 Agent 上下文。',
      parameters: {
        type: 'object', properties: {
          projectId: string('Project id'), title: string('Source title'), text: string('Source text'),
          sourcePath: string('Workspace-relative TXT/Markdown path; use instead of text'),
          format: string('text|txt|markdown|md'), sourceId: string('Optional stable source id'), commandId: string('Stable idempotency key'),
          workspaceId: string('Optional workspace id'),
        }, required: ['projectId', 'title'],
      }, output,
      async execute(args, exec) {
        try {
          const service = await sourceServiceFor(exec, args)
          const text = args.text || (args.sourcePath && sourceTextFor ? await sourceTextFor(exec, args) : '')
          if (!text) throw new Error('text or sourcePath required')
          const response = await service.importText({ ...args, text })
          const source = response.project.sourceDocuments[response.output.sourceId]
          return result({ revision: response.project.revision, ...response.output, bytes: source?.bytes, characters: source?.characters })
        } catch (error) { return settleFailure(error) }
      },
    },
    {
      name: 'studio_source_read', description: '按字符游标分块读取已导入源文，并校验内容 hash。',
      parameters: {
        type: 'object', properties: {
          projectId: string('Project id'), sourceId: string('Source document id'),
          cursor: { type: 'integer', description: 'Start character offset' }, limit: { type: 'integer', description: 'Maximum characters, up to 32768' },
          workspaceId: string('Optional workspace id'),
        }, required: ['projectId', 'sourceId'],
      }, output,
      async execute(args, exec) {
        try { return result(await (await sourceServiceFor(exec, args)).readChunk(args)) } catch (error) { return settleFailure(error) }
      },
    },
    submit('studio_content_analysis_submit', '提交内容分析候选，批准后写入故事圣经、角色和场景。', 'content_analysis'),
    submit('studio_asset_design_submit', '提交角色与场景视觉设定，仅更新现有实体的视觉描述。', 'asset_design'),
    submit('studio_asset_extraction_submit', '从正式剧本提取角色、场景、道具、衍生状态和完整图片提示词。', 'asset_extraction'),
    submit('studio_shot_prompts_submit', '提交逐镜独立图片和视频提示词，不修改剧本或镜头计划。', 'shot_prompts'),
    submit('studio_episode_plan_submit', '提交分集规划候选，批准后写入 Episode 大纲。', 'episode_plan'),
    submit('studio_episode_draft_submit', '提交正式分集剧本，不包含镜头；镜头由分镜 subagent 单独规划。', 'episode_draft'),
    submit('studio_episode_script_submit', '提交正式剧本候选，批准后原子写入 Episode.script 和 Shot。', 'episode_script'),
    {
      name: 'studio_development_get', description: '读取源文和内容开发 Proposal。',
      parameters: {
        type: 'object', properties: { projectId: string('Project id'), proposalId: string('Optional proposal id') }, required: ['projectId'],
      }, output,
      async execute(args) {
        try {
          const project = await projectService.getProject(args.projectId)
          return result(args.proposalId ? project.developmentProposals[args.proposalId] || null : {
            sources: Object.values(project.sourceDocuments), proposals: Object.values(project.developmentProposals),
          })
        } catch (error) { return settleFailure(error) }
      },
    },
  ]
}
