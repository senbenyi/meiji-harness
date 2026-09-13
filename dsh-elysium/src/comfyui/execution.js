// 职责：准备、提交并等待单次 ComfyUI 视频工作流。
import { join } from 'node:path'
// 职责：准备、提交并等待已冻结的 ComfyUI 工作流。
import { readJson, saveJson } from '../jobs/store.js'

// Recovery uses the saved graph, never current templates or changed media references.
export async function prepareComfyWorkflow(directory, client, plan, prepare) {
  const path = join(directory, 'comfyui-workflow.json')
  let prepared = await readJson(path)
  if (!prepared) {
    prepared = await prepare()
    await client.timing.measure('prepare.validate', () => client.validate(prepared.graph))
    await saveJson(path, prepared)
  }
  if (JSON.stringify(prepared.plan) !== JSON.stringify(plan) || prepared.server_url !== client.url.href) {
    throw new Error('恢复请求或后端与原任务不一致')
  }
  if (prepared.workflow) await saveJson(join(directory, 'comfyui-workflow-ui.json'), prepared.workflow)
  return prepared
}

export async function runComfyWorkflow(directory, client, prepared, status, timeoutMs) {
  const statusPath = join(directory, 'status.json')
  status.workflow_name = prepared.workflowName
  status.stage = 'submit'
  await saveJson(statusPath, status)
  const resume = await readJson(join(directory, 'resume-request.json'))
  const promptId = await client.timing.measure('submit', () => client.submit(prepared.graph, status.job_id,
    join(directory, 'comfyui-submission.json'), resume?.retry_failed === true, prepared.workflow))
  await saveJson(join(directory, 'resume-request.json'), { retry_failed: false })
  status.comfyui_prompt_id = promptId
  status.debug?.chain?.push({ stage: 'comfyui-submitted', server_url: client.url.href, prompt_id: promptId })
  status.stage = 'execute'
  await saveJson(statusPath, status)
  const history = await client.timing.measure('wait.history', () => client.wait(promptId, timeoutMs, async (_, stage) => {
    if (status.stage !== stage) {
      status.stage = stage
      await saveJson(statusPath, status)
    }
  })).catch(async error => {
    if (error.history) await saveJson(join(directory, 'comfyui-history.json'), error.history)
    throw error
  })
  status.remote_status = 'succeeded'
  await saveJson(statusPath, status)
  await saveJson(join(directory, 'comfyui-history.json'), history)
  return { promptId, history }
}
