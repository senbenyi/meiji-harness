// 职责：把角色视图与三视图工作流适配为 Harness 工具。
import { characterSheet, characterView } from '../../server/workflows/images/characters.js'
import { generationProjectId } from '../project/context.js'
import { renderToolDebug } from '../core/output.js'

const output = { schema: { type: 'object', additionalProperties: true, properties: { job_id: { type: 'string' }, status: { type: 'string' } }, required: ['job_id', 'status'] }, render: renderToolDebug }

export function createCharacterTools() {
  const id = { type: 'string', pattern: '^[a-f0-9]{32}$' }
  const project = { type: 'string', pattern: '^[a-f0-9]{8}$' }
  return [{ name: 'model_character_view', description: '生成固定角色的正面、侧面或背面视图；先确认 front，再以同一正面任务生成 side/back，每视角最多三次。', timeoutMs: 121 * 60_000,
    parameters: { type: 'object', additionalProperties: false, properties: { project_id: project, reference_job_id: id,
      description: { type: 'string' }, view: { type: 'string', enum: ['front', 'side', 'back'] }, retry: { type: 'boolean' } }, required: ['description', 'view'] },
    output, execute: async (args, exec) => characterView(args, exec, await generationProjectId(args.project_id, exec)) },
  { name: 'model_character_sheet', description: '把同一角色已确认的正面、侧面和背面按像素边界拼成三视图，不重新生成角色。', timeoutMs: 121 * 60_000,
    parameters: { type: 'object', additionalProperties: false, properties: { project_id: project, reference_job_id: id, side_job_id: id, back_job_id: id,
      crops: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'object', additionalProperties: false,
        properties: Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, { type: 'integer', minimum: ['x', 'y'].includes(key) ? 0 : 1 }])), required: ['x', 'y', 'width', 'height'] } },
    }, required: ['reference_job_id', 'side_job_id', 'back_job_id', 'crops'] }, output,
    execute: async (args, exec) => characterSheet(args, exec, await generationProjectId(args.project_id, exec)) }]
}
