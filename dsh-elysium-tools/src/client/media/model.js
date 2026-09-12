window.__ModuleLoader__.load({
  id: 'elysium-tools/media-model', factory: () => {
    function fromBlock(block) {
      for (const item of block?.content || []) {
        if (item.type !== 'text') continue
        try {
          const value = JSON.parse(item.text)
          const result = value.output || value
          if (result.job_id && result.status) return { ...result, media_kind: 'video' }
        } catch { /* The generic result remains available in details. */ }
      }
      if (block?.isError) {
        const error = (block.content || []).filter(item => item.type === 'text').map(item => item.text).join('\n')
        // These validation errors occur before startVideoJob creates any job or worker.
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
      const spec = job.specification, info = job.media_info
      const parts = [], profile = { preview: '预览档', regular: '常规档', 'high-quality': '高清档', standard: '原工作流' }[job.profile]
      if (profile) parts.push(profile)
      const width = info?.width || spec?.width, height = info?.height || spec?.height
      if (width && height) parts.push(`${width}×${height}`)
      const seconds = info?.duration_seconds ?? spec?.seconds
      if (Number.isFinite(seconds)) parts.push(`约 ${Number(seconds.toFixed(1))} 秒视频`)
      if (Number.isFinite(spec?.steps)) parts.push(`${spec.steps} 步`)
      if (info?.has_audio !== undefined) parts.push(info.has_audio ? '带音频' : '无音频')
      else if (spec?.audio === 'joint-generation-and-decoding') parts.push('带音频')
      return parts.join('、')
    }
    return { fromBlock, label, specificationLabel }
  },
})
