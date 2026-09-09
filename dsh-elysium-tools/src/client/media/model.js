window.__ModuleLoader__.load({
  id: 'elysium-tools/media-model', factory: () => {
    function fromBlock(block) {
      for (const item of block?.content || []) {
        if (item.type !== 'text') continue
        try {
          const value = JSON.parse(item.text)
          const result = value.output || value
          if (result.job_id && result.status) return { ...result, media_kind: result.media_kind || (/\.(png|jpe?g|webp)(?:[?&#]|$)/i.test(result.path || result.comfyui_view_url || '') ? 'image' : 'video') }
        } catch { /* The generic result remains available in details. */ }
      }
      if (block?.isError) {
        const error = (block.content || []).filter(item => item.type === 'text').map(item => item.text).join('\n')
        // These validation errors occur before startVideoJob creates any job or worker.
        if (/MODEL_INPUT_INVALID|短视频一条提示词|包含未支持的工作流参数|duration 必须为正整数|提供非空分镜提示词|已有视频列表不能为空|长视频需要首帧/.test(error)) {
          return { status: 'rejected', error }
        }
        return { status: 'interrupted' }
      }
      return { status: 'pending' }
    }
    const stages = { prepare: '准备素材', submit: '提交任务', queued: '排队中', execute: '工作流执行中', reconcile: '核对原任务', 'inspect-output': '校验产物', generate: '生成视频', image: '生成首帧', start: '准备衔接画面', render: '整理镜头', finalize: '整理成片', completed: '已完成' }
    function label(job) {
      if (job.status === 'succeeded') return '已完成'
      if (job.status === 'failed') return job.remote_status === 'succeeded' ? '产物待校验' : job.error_code === 'LOCAL_WORKER_STOPPED' || job.error_code === 'WORKER_NOT_RUNNING' ? '本地处理已停止' : '任务未完成'
      if (job.status === 'interrupted') return '等待已中断，正在核对后台任务'
      if (job.status === 'pending') return '正在创建任务'
      if (job.status === 'rejected') return '参数未通过，未创建任务'
      if (job.stage?.includes(':')) {
        const [shot, stage] = job.stage.split(':')
        return `镜头 ${shot}：${stages[stage] || '制作中'}`
      }
      return stages[job.stage] || (job.status === 'queued' ? '排队中' : '制作中')
    }
    return { fromBlock, label }
  },
})
