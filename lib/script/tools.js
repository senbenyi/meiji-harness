import { randomUUID } from 'node:crypto'

const output = {
  schema: { type: 'object', properties: { ok: { type: 'boolean' }, json: { type: 'string' }, error: { type: 'string' } } },
  render: (_args, value) => [{ type: 'text', text: value.ok ? value.json : `失败：${value.error}` }],
}

const string = (description) => ({ type: 'string', description })

function result(value) { return { ok: true, json: JSON.stringify(value), error: '' } }
function failure(error) { return { ok: false, json: '', error: error?.message || String(error) } }

export function makeScriptDevelopmentTools({ projectService, sourceServiceFor }) {
  const submit = (name, description, kind) => ({
    name, description,
    parameters: {
      type: 'object',
      properties: {
        projectId: string('Project id'), revision: { type: 'integer', description: 'Expected Project revision' },
        proposalId: string('Optional stable proposal id'), sourceRefs: string('JSON array of {sourceId,contentHash}'),
        payload: string('Structured proposal payload JSON'), commandId: string('Stable idempotency key'),
      },
      required: ['projectId', 'revision', 'sourceRefs', 'payload'],
    },
    output,
    async execute(args) {
      try {
        const response = await projectService.execute({
          projectId: args.projectId, commandId: args.commandId || randomUUID(), expectedRevision: args.revision,
          type: 'submitDevelopmentProposal',
          payload: { proposalId: args.proposalId, kind, sourceRefs: JSON.parse(args.sourceRefs), payload: JSON.parse(args.payload) },
          actor: 'script-development',
        })
        return result({ revision: response.project.revision, ...response.output })
      } catch (error) { return failure(error) }
    },
  })

  return [
    {
      name: 'studio_source_import', description: '导入不可变纯文本源文；支持 text/txt/markdown/md。',
      parameters: {
        type: 'object', properties: {
          projectId: string('Project id'), title: string('Source title'), text: string('Source text'),
          format: string('text|txt|markdown|md'), sourceId: string('Optional stable source id'), commandId: string('Stable idempotency key'),
          workspaceId: string('Optional workspace id'),
        }, required: ['projectId', 'title', 'text'],
      }, output,
      async execute(args, exec) {
        try {
          const service = await sourceServiceFor(exec, args)
          const response = await service.importText(args)
          return result({ revision: response.project.revision, ...response.output })
        } catch (error) { return failure(error) }
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
        try { return result(await (await sourceServiceFor(exec, args)).readChunk(args)) } catch (error) { return failure(error) }
      },
    },
    submit('studio_content_analysis_submit', '提交内容分析候选，批准后写入故事圣经、角色和场景。', 'content_analysis'),
    submit('studio_episode_plan_submit', '提交分集规划候选，批准后写入 Episode 大纲。', 'episode_plan'),
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
        } catch (error) { return failure(error) }
      },
    },
  ]
}
