const EMPTY_DRAFT = JSON.stringify({
  schema_version: 'vmp-1',
  episode_id: 'mvp-new-episode',
  title: '新短剧',
  source_text: '完整故事梗概',
  profile: 'preview',
  seed: 88666,
  cast_prompt: '虚构成年角色的统一外貌、服装和画面风格',
  negative_prompt: '未成年人，非自愿，侵权素材，畸形肢体，水印，字幕',
  compliance: {
    fictional_adults_only: true,
    all_participants_18_or_older: true,
    consensual_content: true,
    rights_confirmed: true,
  },
  shots: Array.from({ length: 12 }, (_, index) => ({
    id: `shot-${String(index + 1).padStart(2, '0')}`,
    image_prompt: `第 ${index + 1} 镜的构图、人物动作、场景和光线`,
    video_prompt: `第 ${index + 1} 镜的动作延续和运镜`,
  })),
}, null, 2)

function jsonText(value) {
  return JSON.stringify(value, null, 2)
}

export function createFactory(React, api) {
  const { createElement: h, useCallback, useEffect, useMemo, useState } = React

  return function Factory() {
    const [specs, setSpecs] = useState([])
    const [selected, setSelected] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [message, setMessage] = useState('')
    const [details, setDetails] = useState(null)
    const [job, setJob] = useState(null)
    const [authorized, setAuthorized] = useState(false)
    const [reviewed, setReviewed] = useState(false)
    const [reviewer, setReviewer] = useState('')
    const [retryTarget, setRetryTarget] = useState('')
    const [draft, setDraft] = useState(EMPTY_DRAFT)
    const [artifactReady, setArtifactReady] = useState(false)

    const selectedSpec = useMemo(
      () => specs.find(item => item.spec === selected) || null,
      [specs, selected],
    )
    const episodeId = selectedSpec?.episode_id || job?.episode_id || details?.contract?.episode_id || ''

    const call = useCallback(async (payload, quiet = false) => {
      if (!quiet) {
        setBusy(true)
        setError('')
        setMessage('')
      }
      try {
        const result = await api.fetchJson('/factory.execute', payload)
        setDetails(result)
        return result
      } catch (reason) {
        setError(reason.message || String(reason))
        return null
      } finally {
        if (!quiet) setBusy(false)
      }
    }, [])

    const refreshList = useCallback(async () => {
      const result = await call({ action: 'list' }, true)
      if (!result) return
      const next = result.specs || []
      setSpecs(next)
      setSelected(current => next.some(item => item.spec === current) ? current : (next.find(item => item.valid)?.spec || ''))
    }, [call])

    useEffect(() => { void refreshList() }, [refreshList])

    useEffect(() => {
      if (!job?.id || job.status !== 'running') return undefined
      let cancelled = false
      const poll = async () => {
        const result = await call({ action: 'job', job_id: job.id }, true)
        if (cancelled || !result?.state) return
        const nextJob = { ...job, status: result.state.status === 'running' ? 'running' : result.state.status === 'failed' ? 'failed' : 'succeeded' }
        setJob(nextJob)
        setDetails(result)
        if (nextJob.status === 'succeeded') {
          setMessage('生产流水线已完成。请加载成片和 QC 后完整观看。')
        } else if (nextJob.status === 'failed') {
          setError(result.state.events?.at(-1)?.message || '生产流水线失败')
        }
      }
      void poll()
      const timer = window.setInterval(() => void poll(), 2500)
      return () => {
        cancelled = true
        window.clearInterval(timer)
      }
    }, [job?.id, job?.status, call])

    const requireSpec = () => {
      if (selected) return true
      setError('请先选择生产单')
      return false
    }

    const inspect = async action => {
      if (!requireSpec()) return
      const result = await call({ action, spec: selected })
      if (result) setMessage(action === 'check' ? '生产单和 12 镜合同检查通过。' : '已刷新生产状态。')
    }

    const start = async () => {
      if (!requireSpec()) return
      if (!authorized) {
        setError('启动付费生成前必须勾选成年人、同意与素材权利确认')
        return
      }
      const checked = await call({ action: 'check', spec: selected })
      if (!checked) return
      const result = await call({
        action: 'run',
        stage: 'all',
        spec: selected,
        confirm_authorized_adults: true,
      })
      if (result?.job) {
        setJob(result.job)
        setArtifactReady(false)
        setMessage(`生产任务已提交：${result.job.id}`)
      }
    }

    const sync = async artifact => {
      if (!episodeId) {
        setError('无法确定 episode_id，请先选择有效生产单')
        return
      }
      const result = await call({ action: 'sync', episode_id: episodeId, artifact })
      if (result) {
        if (artifact === 'final') setArtifactReady(true)
        setMessage(`${artifact} 已同步到本机。`)
      }
    }

    const approve = async () => {
      if (!requireSpec()) return
      if (!reviewed) {
        setError('只有完整观看成片并确认画面、连续性、合规和交付质量后才能登记人审')
        return
      }
      const result = await call({
        action: 'approve',
        spec: selected,
        reviewer,
        confirm_human_review_passed: true,
      })
      if (result) {
        setMessage('人工验收已经绑定到当前成片哈希。')
        await sync('review')
      }
    }

    const retry = async () => {
      if (!requireSpec()) return
      if (!retryTarget) {
        setError('请选择需要重试的镜头、视频块或成片')
        return
      }
      const result = await call({ action: 'retry', spec: selected, target: retryTarget })
      if (result) {
        setMessage(`${retryTarget} 已重置；再次启动生产会从该断点续跑。`)
        setRetryTarget('')
      }
    }

    const create = async () => {
      let episode
      try {
        episode = JSON.parse(draft)
      } catch {
        setError('生产单 JSON 格式错误')
        return
      }
      const result = await call({ action: 'create', episode })
      if (result) {
        await refreshList()
        setSelected(result.spec)
        setMessage(`已创建生产单：${result.spec}`)
      }
    }

    const videoUrl = artifactReady && episodeId
      ? `/toonflow/factory-file?episode_id=${encodeURIComponent(episodeId)}&artifact=final`
      : ''

    return h('div', null,
      h('div', { className: 'tf-header' },
        h('div', null,
          h('div', { className: 'tf-title' }, 'AI 成人短剧工厂'),
          h('div', { className: 'tf-card-meta' }, '固定 12 镜 · 2 个视频块 · 成片 ≥40 秒 · 模型全部远程执行'),
        ),
        h('button', { className: 'tf-btn tf-btn-ghost', disabled: busy, onClick: refreshList }, '刷新'),
      ),
      error ? h('div', { className: 'tf-error' }, error) : null,
      message ? h('div', { className: 'tf-factory-ok' }, message) : null,
      h('div', { className: 'tf-factory-grid' },
        h('section', { className: 'tf-factory-panel' },
          h('div', { className: 'tf-section-title' }, '生产单'),
          h('select', {
            className: 'tf-input',
            value: selected,
            onChange: event => {
              setSelected(event.target.value)
              setDetails(null)
              setJob(null)
              setArtifactReady(false)
            },
          },
          h('option', { value: '' }, specs.length ? '请选择' : '暂无生产单'),
          specs.map(item => h('option', { key: item.spec, value: item.spec, disabled: !item.valid },
            item.valid ? `${item.title} · ${item.profile}` : `${item.spec} · 无效`,
          ))),
          selectedSpec ? h('div', { className: 'tf-factory-contract' },
            h('span', null, `${selectedSpec.episode_id}`),
            h('span', null, '12 镜'),
            h('span', null, '2 块'),
            h('span', null, '≥40 秒'),
          ) : null,
          h('div', { className: 'tf-btn-row' },
            h('button', { className: 'tf-btn tf-btn-ghost', disabled: busy || !selected, onClick: () => inspect('check') }, '检查'),
            h('button', { className: 'tf-btn tf-btn-ghost', disabled: busy || !selected, onClick: () => inspect('status') }, '生产状态'),
          ),
          h('label', { className: 'tf-factory-check' },
            h('input', { type: 'checkbox', checked: authorized, onChange: event => setAuthorized(event.target.checked) }),
            h('span', null, '确认角色均为已授权的虚构成年人，内容自愿，素材权利清晰'),
          ),
          h('button', { className: 'tf-btn tf-factory-primary', disabled: busy || !selected || job?.status === 'running', onClick: start },
            job?.status === 'running' ? '生产中…' : '启动完整生产',
          ),
          details?.state?.progress ? h('div', { className: 'tf-factory-contract' },
            h('span', null, `镜头图 ${details.state.progress.images_ready}/12`),
            h('span', null, `视频块 ${details.state.progress.blocks_ready}/2`),
            h('span', null, details.state.final?.duration_seconds ? `成片 ${details.state.final.duration_seconds}s` : '成片待生成'),
          ) : null,
          h('div', { className: 'tf-btn-row' },
            h('select', { className: 'tf-input', value: retryTarget, onChange: event => setRetryTarget(event.target.value) },
              h('option', { value: '' }, '选择重试目标'),
              Array.from({ length: 12 }, (_, index) => h('option', { key: index, value: `shot-${String(index + 1).padStart(2, '0')}` }, `镜头 ${index + 1}`)),
              h('option', { value: 'block-01' }, '视频块 1'),
              h('option', { value: 'block-02' }, '视频块 2'),
              h('option', { value: 'final' }, '最终成片'),
            ),
            h('button', { className: 'tf-btn tf-btn-ghost', disabled: busy || !retryTarget, onClick: retry }, '重置并续跑'),
          ),
        ),
        h('section', { className: 'tf-factory-panel' },
          h('div', { className: 'tf-section-title' }, '交付与验收'),
          h('div', { className: 'tf-btn-row' },
            h('button', { className: 'tf-btn tf-btn-ghost', disabled: busy || !episodeId, onClick: () => sync('final') }, '同步成片'),
            h('button', { className: 'tf-btn tf-btn-ghost', disabled: busy || !episodeId, onClick: () => sync('qc') }, '同步 QC'),
            h('button', { className: 'tf-btn tf-btn-ghost', disabled: busy || !episodeId, onClick: () => sync('review') }, '同步人审'),
          ),
          videoUrl ? h('video', { className: 'tf-factory-video', src: videoUrl, controls: true, preload: 'metadata' }) : null,
          h('input', {
            className: 'tf-input',
            value: reviewer,
            placeholder: '审核人标识（字母/数字/._-）',
            onChange: event => setReviewer(event.target.value),
          }),
          h('label', { className: 'tf-factory-check' },
            h('input', { type: 'checkbox', checked: reviewed, onChange: event => setReviewed(event.target.checked) }),
            h('span', null, '我已完整观看当前成片，并确认人物、肢体、镜头语义、合规和交付质量通过'),
          ),
          h('button', { className: 'tf-btn', disabled: busy || !reviewer || !reviewed, onClick: approve }, '登记人工验收'),
        ),
      ),
      h('details', { className: 'tf-factory-panel tf-factory-create' },
        h('summary', null, '新建生产单（JSON）'),
        h('p', { className: 'tf-card-meta' }, '聊天框也可调用 Toonflow 工具创建。必须填写 shot-01 到 shot-12，每镜包含 image_prompt 与 video_prompt。'),
        h('textarea', { className: 'tf-textarea tf-factory-json', value: draft, onChange: event => setDraft(event.target.value) }),
        h('button', { className: 'tf-btn', disabled: busy, onClick: create }, '校验并创建'),
      ),
      details ? h('details', { className: 'tf-factory-panel', open: job?.status === 'failed' },
        h('summary', null, '任务详情'),
        h('pre', { className: 'tf-factory-log' }, jsonText(details)),
      ) : null,
    )
  }
}
