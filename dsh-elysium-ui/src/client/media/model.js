window.__ModuleLoader__.load({
  id: 'elysium-ui/media-model', factory: () => {
    function fromBlock(block) {
      for (const item of block?.content || []) {
        if (item.type !== 'text') continue
        try {
          const value = JSON.parse(item.text)
          const result = value.output || value
          if (result.job_id && result.status) return result
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
    const stages = { queued: '排队中', generate: '生成视频', image: '生成首帧', start: '准备衔接画面', render: '整理镜头', finalize: '整理成片', completed: '已完成' }
    function label(job) {
      if (job.status === 'succeeded') return '已完成'
      if (job.status === 'failed') return '生成失败'
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
