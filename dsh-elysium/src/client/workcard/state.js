// 职责：将 Harness 工具结果解析为媒体任务状态与可读标签。
window.__ModuleLoader__.load({
  id: 'elysium/media-task-state', factory: () => {
    function fromBlock(block) {
      for (const item of block?.content || []) {
        if (item.type !== 'text') continue
        try {
          const value = JSON.parse(item.text)
          const result = value.output || value
          if (result.job_id && result.status) return { ...result, media_kind: result.media_kind || result.result?.media_kind || (result.capability === 'workflow-image' ? 'image' : 'video') }
        } catch { /* The generic result remains available in details. */ }
      }
      if (block?.isError) {
        const error = (block.content || []).filter(item => item.type === 'text').map(item => item.text).join('\n')
        // These validation errors occur before submitTask creates any job or worker.
        if (/MODEL_INPUT_INVALID|包含未支持的工作流参数/.test(error)) {
          return { status: 'rejected', error }
        }
        return { status: 'interrupted' }
      }
      return { status: 'pending' }
    }
    const stages = { reconnecting: '连接中断，正在重试原视频', prepare: '准备素材', submit: '提交任务', queued: '排队中', execute: '工作流执行中', reconcile: '核对原任务', 'inspect-output': '校验产物', completed: '已完成' }
    function label(job) {
      if (job.status === 'succeeded') return '已完成'
      if (job.status === 'failed') return job.remote_status === 'succeeded' ? '产物待校验' : job.error_code === 'LOCAL_WORKER_STOPPED' || job.error_code === 'WORKER_NOT_RUNNING' ? '本地处理已停止' : '任务未完成'
      if (job.status === 'interrupted') return '等待已中断，正在核对后台任务'
      if (job.status === 'pending') return '正在创建任务'
      if (job.status === 'rejected') return '参数未通过，未创建任务'
      return stages[job.stage] || (job.status === 'queued' ? '排队中' : '制作中')
    }
    function specificationLabel(job) {
      const spec = job.specification
      const parts = [], quality = { fast: '快速创作', regular: '常规创作', high: '高清创作' }[job.quality]
        || { preview: '快速创作', regular: '常规创作', 'high-quality': '高清创作', standard: '原工作流' }[job.profile]
      if (quality) parts.push(quality)
      const width = spec?.width, height = spec?.height
      if (width && height) parts.push(`${width}×${height}`)
      const seconds = spec?.seconds
      if (Number.isFinite(seconds)) parts.push(`约 ${Number(seconds.toFixed(1))} 秒视频`)
      if (Number.isFinite(spec?.steps)) parts.push(`${spec.steps} 步`)
      if (spec?.audio === 'joint-generation-and-decoding') parts.push('带音频')
      return parts.join('、')
    }
    return { fromBlock, label, specificationLabel }
  },
})
