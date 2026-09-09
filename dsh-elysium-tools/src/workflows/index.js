import { resumeMediaJob } from './media-jobs.js'
import { createCharacterTools } from './character.js'
import { renderToolDebug } from '../functions/common/tool.js'
import { createWorkflowGenerateVideoTool, createWorkflowResumeVideoTool } from './workflow-generate-video.js'

export { createWorkflowGenerateVideoTool, createWorkflowResumeVideoTool }

export function createWorkflowTools() {
  return [createWorkflowGenerateVideoTool(), createWorkflowResumeVideoTool(), ...createCharacterTools(), {
    name: 'model_job_resume', description: '恢复原 ComfyUI 图片、视频或合片任务，不重新创建任务。', timeoutMs: 2 * 60 * 60 * 1000,
    parameters: { type: 'object', properties: { job_id: { type: 'string' } }, required: ['job_id'], additionalProperties: false },
    output: { schema: { type: 'object', properties: { job_id: { type: 'string' }, status: { type: 'string' } }, required: ['job_id', 'status'] }, render: renderToolDebug },
    execute: (args, exec) => resumeMediaJob(args.job_id, exec),
  }]
}
