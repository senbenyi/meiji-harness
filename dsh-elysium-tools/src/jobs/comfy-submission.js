import { readJson, saveJson } from './json.js'

export async function submitComfyPrompt(client, graph, jobId, path, retryFailed = false, workflow) {
  let saved = await readJson(path)
  if (saved && saved.server_url !== client.url.href) throw new Error('原任务属于其他后端；恢复时必须使用原地址')
  if (saved?.prompt_id && retryFailed) {
    const history = (await client.request(`history/${encodeURIComponent(saved.prompt_id)}`))[saved.prompt_id]
    if (history?.status?.status_str === 'error') {
      await saveJson(`${path}.${saved.prompt_id}.failed.json`, saved)
      saved = null
    }
  }
  if (saved?.prompt_id) return saved.prompt_id
  if (saved?.submitting) {
    // A lost POST response must not create a second GPU job.
    const [queue, history] = await Promise.all([client.request('queue'), client.request('history')])
    const prompts = [...(queue.queue_running || []), ...(queue.queue_pending || []),
      ...Object.values(history).map(item => item.prompt)]
    const prompt = prompts.find(item => item?.[3]?.elysium_job_id === jobId)
    if (!prompt) throw new Error('提交结果未确认；请核对原队列与历史，禁止自动重复提交')
    saved.prompt_id = prompt[1]
  } else {
    saved = { server_url: client.url.href, submitting: true, job_id: jobId }
    await saveJson(path, saved)
    let result
    try { result = await client.request('prompt', { prompt: graph, client_id: jobId, extra_data: { elysium_job_id: jobId, ...(workflow ? { extra_pnginfo: { workflow } } : {}) } }) } catch (error) {
      // Only an explicit validation rejection proves that nothing was enqueued.
      if (error.node_errors) await saveJson(path, { server_url: client.url.href, rejected: true })
      throw error
    }
    if (!result.prompt_id) throw new Error('ComfyUI 提交响应缺少 prompt_id，不能重复提交')
    saved.prompt_id = result.prompt_id
  }
  await saveJson(path, saved)
  return saved.prompt_id
}
