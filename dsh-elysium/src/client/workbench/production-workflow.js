// 职责：编排六步创作导航、人工审核、单段/全片提交与时间线导出。
window.__ModuleLoader__.load({ id: 'elysium/production-workflow', factory: require => {
  const { createElement: h, useState, useEffect } = require('react')
  const { workflowAction } = require('elysium/project-api'), { Rail, Step, inputFor, videoFor, productionStatuses } = require('elysium/production-ui')
  const { Field, SegmentEditor, ShotEditor } = require('elysium/segment-editor')
  const { MaterialList } = require('elysium/materials'), { Dialog } = require('elysium/dialog')
  const { assetUrl, saveExport } = require('elysium/media-api')
  function ExportDownload({ project, output }) {
    const [saving, setSaving] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('')
    const download = async () => {
      if (saving) return
      setSaving(true); setMessage(''); setError('')
      try { setMessage(await saveExport(project, output)) }
      catch (err) { setError(`下载失败：${err.message}`) }
      finally { setSaving(false) }
    }
    return h('div', null, h('button', { disabled: saving || output.status !== 'succeeded' || !output.url, onClick: download }, saving ? '正在保存…' : '下载成片'),
      message ? h('p', { role: 'status' }, message) : null, error ? h('p', { role: 'alert' }, error) : null)
  }
  function ProjectWorkflow({ project, busy, run, guard, error, notice, viewState, onViewState = () => {}, railToggle = null }) {
    const p = project.production
    const session = require('elysium/project-generation').useProductionSession(project.chat_session_id)
    const [page, setPage] = useState(viewState?.page?.type === 'timeline' ? { type: 'compose' } : viewState?.page || { type: 'overview' }), [editor, setEditor] = useState({ key: '', value: null }), [dirty, setDirty] = useState(false), [materialsOpen, setMaterialsOpen] = useState(false), [imagePrompt, setImagePrompt] = useState(''), [episodeCount, setEpisodeCount] = useState(project.production?.export_episode_count || 1)
    useEffect(() => { onViewState({ page }) }, [page])
    const pageKey = `${page.type}:${page.id || ''}:${page.shotId || ''}`
    const draft = editor.key === pageKey ? editor.value : null
    const setDraft = value => setEditor({ key: pageKey, value })
    const s = p?.segments.find(s => s.id === page.id)
    const source = page.type === 'description' ? p : page.type === 'scene' ? p?.story.scenes.find(s => s.id === page.id) : page.type === 'shot' ? s?.shots.find(shot => shot.id === page.shotId) : page.type === 'input' ? { prompt: (s && inputFor(s))?.plan.prompt || '', mode: (s && inputFor(s))?.plan.mode || 't2va', reference_asset_id: p?.assets.find(a => a.url === (s && inputFor(s))?.plan.first_frame)?.id || '' } : page.type === 'compose' ? { episode_count: p?.export_episode_count || 1 } : s
    useEffect(() => { if (!dirty) setDraft(source ? structuredClone(source) : null) }, [project.updated_at, page.type, page.id, page.shotId, dirty])
    useEffect(() => { if (!guard || !dirty) return; const leave = next => { if (window.confirm('放弃未保存修改？')) { setDirty(false); next() } }; guard.current = leave; return () => { if (guard.current === leave) guard.current = null } }, [guard, dirty])
    const go = next => { if (dirty && !window.confirm('放弃未保存修改？')) return; setDirty(false); setDraft(null); setPage(next) }
    const change = value => { setDraft(value); setDirty(true) }
    const action = (name, body = {}) => workflowAction(project.id, `production-${name}`, { revision: p?.revision, ...body })
    const perform = async (fn, next) => { if (await run(fn)) { setDirty(false); if (next) { setDraft(null); setPage(next) } } }
    const generate = (stage, id, restart = false) => perform(() => require('elysium/project-generation').generateProduction(project, stage, id, restart))
    const restartAction = (name, body = {}) => perform(() => require('elysium/project-generation').restartProductionAction(project, name, body))
    if (!p) return h('div', { className: 'elysium-series-empty' }, h('h2', null, project.title), h('p', null, '此项目使用旧剧集结构。保留原始数据，使用旧剧情重新规划 Scene 和 Segment。'), h('button', { disabled: busy, onClick: () => perform(() => action('initialize')) }, '开始新流程'))
    const stages = { description: '创作要求', story: '剧情与 Segment', segments: '片段规划', shots: '分镜', inputs: 'H3 输入', videos: '视频', compose: '完整成片' }
    const statuses = productionStatuses(p, session)
    const locked = busy || !!p.request || ['running', 'paused', 'stopping'].includes(p.queue?.status)
    const storySeconds = p.story.scenes.reduce((n, scene) => n + scene.duration, 0), storyMismatch = Math.abs(storySeconds - p.target_seconds) > 30
    const count = p.segments.length, shotsReady = p.segments.filter(s => s.shots_revision === s.revision && s.shots.length).length, inputsReady = p.segments.filter(s => inputFor(s)).length, videosReady = p.segments.filter(s => !s.tail_stale && inputFor(s) && videoFor(s)?.url && (videoFor(s).input_id === inputFor(s).id || s.selected_for_input === inputFor(s).id)).length
    const rail = (label, items, type, describe, current) => h(Rail, { label, items, describe, current, open: item => go({ type, id: item.id }) })
    const button = (label, fn, disabled = locked) => h('button', { disabled, onClick: fn }, label)
    const composing = p.exports.some(e => ['pending', 'running'].includes(e.status))
    const chatModel = () => h(require('elysium/project-generation').StoryModel, { sessionId: project.chat_session_id })
    const runStage = stage => ({ ...statuses[stage], next: '执行', action: () => generate(stage, undefined, true), disabled: busy, model: chatModel() })
    const videoStatus = g => p.queue?.status === 'interrupted' && ['pending', 'running'].includes(g?.status) ? '已中断' : ({ pending: '等待生成', running: '生成中', succeeded: '已完成', failed: '生成失败', superseded: '已被重新执行替换' }[g?.status] || '未开始')
    const exportStatus = e => ({ pending: '等待合片', running: '合片中', succeeded: '已完成', failed: '合片失败', superseded: '已被重新执行替换', interrupted: '已中断' }[e.status] || e.status)
    const composeForm = h('div', { className: 'elysium-production-form' },
      h(Field, { label: '总集数', type: 'number', value: episodeCount, change: setEpisodeCount }),
      h('p', null, `共 ${count} 个片段，按剧情顺序完整拼接，保留原声音。`),
      Number.isInteger(episodeCount) && episodeCount >= 1 && episodeCount <= count ? h('p', null, `预计每集约 ${(p.segments.reduce((n, s) => n + (videoFor(s)?.duration || s.duration), 0) / episodeCount).toFixed(1)} 秒；实际按完整片段边界分配。`) : h('p', { role: 'alert' }, `总集数须为 1～${count || 1} 的整数`))
    const composeDisabled = busy
    const submitComposition = () => perform(() => require('elysium/project-generation').restartProductionAction(project, 'compose', { episode_count: episodeCount }), { type: 'overview' })
    const currentStage = p.request?.stage || (composing ? 'compose' : ['running', 'paused', 'stopping', 'interrupted'].includes(p.queue?.status) ? 'videos' : '')
    const currentFlow = currentStage ? `当前流程：${stages[currentStage] || currentStage}  ${statuses[currentStage].status}` : ''
    const referenceMarker = '\n\n参考剧情：\n', referenceIndex = (p.requirements || '').indexOf(referenceMarker)
    const requirements = referenceIndex < 0 ? p.requirements : p.requirements.slice(0, referenceIndex)
    const script = referenceIndex < 0 ? project.configuration?.reference_text : p.requirements.slice(referenceIndex + referenceMarker.length)
    let content, footer, title = project.title
    if (page.type === 'overview') content = h('div', { className: 'elysium-series-overview' },
      h(Step, { number: 1, title: '项目描述', ...statuses.description, retry: () => go({ type: 'description' }), retryLabel: '编辑', retryDisabled: busy }, h('div', { className: 'elysium-description-fields' },
        h('p', null, h('strong', null, '标题：'), h('span', null, project.title)),
        h('p', null, h('strong', null, '风格：'), h('span', null, p.style || '由 AI 规划')),
        h('p', null, h('strong', null, '画幅：'), h('span', null, p.aspect_ratio)),
        h('p', null, h('strong', null, '目标总时长：'), h('span', null, `${p.target_seconds} 秒`)),
        h('p', null, h('strong', null, '剧本：'), h('span', { className: 'elysium-description-script' }, script?.trim() || '无')))),
      h(Step, { number: 2, title: '生成剧情与 Segment', ...runStage('story'), ...(p.request?.stage === 'segments' ? statuses.segments : statuses.story.status === '已完成' ? statuses.segments : statuses.story), progress: `目标 ${p.target_seconds} 秒 · 剧情 ${storySeconds} 秒 · ${count} 段` },
        p.story.stale || p.story.scenes.length && storyMismatch ? h('p', { role: 'alert' }, '创作要求或总时长不一致，请重新生成剧情') : null,
        h('p', { className: 'elysium-story-summary' }, p.story.text),
        h('h3', { className: 'elysium-rail-title' }, '剧情场景 Scene'), rail('Scene', p.story.scenes, 'scene', a => a.description, a => `${a.duration} 秒`),
        h('h3', { className: 'elysium-rail-title' }, '视频片段 Segment'), rail('Segment', p.segments, 'segment', s => s.description, s => `${s.duration} 秒 · ${s.character_count || 0} 位人物${s.use_previous_tail ? ' · 沿用上一段尾帧' : ''}`)),
      h(Step, { number: 3, title: '分镜与素材审核', ...runStage('shots'), progress: `分镜完成 ${shotsReady}/${count}` }, rail('片段分镜', p.segments.filter(s => s.shots.length), 'segment', s => s.shots[0]?.action || '进入片段编辑资料、生成分镜', s => `${s.shots.length} 镜${s.shots_revision !== s.revision ? ' · 未开始' : ''}`)),
      h(Step, { number: 4, title: 'H3 输入结果', ...runStage('inputs'), progress: `输入完成 ${inputsReady}/${count}` }, rail('H3 输入', p.segments.filter(s => inputFor(s)), 'input', s => (s && inputFor(s))?.plan.prompt || '待生成', s => inputFor(s) ? '可审核' : '未就绪')),
      h(Step, { number: 5, title: 'Segment 视频', ...statuses.videos, next: '执行', disabled: busy, action: () => restartAction('submit', { regenerate: true }), model: h(require('elysium/project-generation').VideoModel), progress: `已审核视频 ${videosReady}/${count}` }, rail('视频', p.segments.filter(s => s.generations.length), 'video', s => s.tail_stale ? '上一段已变化，请重新生成以更新尾帧衔接' : videoFor(s)?.url ? '点击播放、选择版本或重新制作' : s.generations.at(-1)?.error || '等待生成', s => s.tail_stale ? '需重新生成' : videoStatus(s.generations.at(-1)))),
      h(Step, { number: 6, title: '完整成片', ...statuses.compose, next: '执行', disabled: composeDisabled, action: submitComposition, onOpen: () => go({ type: 'compose' }) },
        h('p', null, `共 ${episodeCount} 集`),
        rail('成片', p.exports.slice().sort((a, b) => b.created_at - a.created_at || (a.episode_number || 1) - (b.episode_number || 1)), 'export', e => e.error || `${e.timeline.clips.length} 个片段 · ${(e.duration || e.planned_duration || e.timeline.clips.reduce((n, c) => n + c.end - c.start, 0)).toFixed(1)} 秒`, e => `${e.title || '历史成片'} · ${exportStatus(e)}`)))
    else if (page.type === 'description' && draft) {
      title = '项目描述'; content = h('div', { className: 'elysium-production-form' }, h(Field, { label: '原始需求', rows: 5, value: draft.original_request, change: v => change({ ...draft, original_request: v }) }), h(Field, { label: '创作要求', rows: 7, value: draft.requirements, change: v => change({ ...draft, requirements: v }) }),
        h(Field, { label: '风格', rows: 3, value: draft.style, change: v => change({ ...draft, style: v }) }), h(Field, { label: '目标总时长（秒）', type: 'number', value: draft.target_seconds, change: v => change({ ...draft, target_seconds: v }) }),
        h('label', { className: 'elysium-field' }, '画幅', h('select', { 'aria-label': '画幅', value: draft.aspect_ratio, onChange: e => change({ ...draft, aspect_ratio: e.target.value }) }, ['9:16', '16:9', '1:1', '3:4', '4:3', '21:9'].map(v => h('option', { key: v }, v)))))
      footer = button('保存', () => restartAction('description', draft), busy || !dirty)
    } else if (page.type === 'scene' && draft) {
      title = draft.title; content = h('div', { className: 'elysium-production-form' }, ...[['title', '场景标题', 0], ['description', '场景剧情', 8], ['location', '地点', 0], ['time', '故事时间', 0], ['duration', '预计时长', 0]].map(([key, label, rows]) => h(Field, { key, label, rows, type: key === 'duration' ? 'number' : 'text', value: draft[key], change: v => change({ ...draft, [key]: v }) })))
      footer = button('保存 Scene', () => perform(() => action('story', { text: p.story.scenes.map(v => v.id === draft.id ? draft.description : v.description).join('\n\n'), scenes: p.story.scenes.map(v => v.id === draft.id ? draft : v) })), locked || !dirty)
    } else if (page.type === 'segment' && s && draft) {
      title = s.title; content = h('div', null, h(SegmentEditor, { value: draft, assets: p.assets, scenes: p.story.scenes, previous: p.segments[p.segments.indexOf(s) - 1], change }),
        h('section', { className: 'elysium-edit-section' }, h('h3', null, '项目共享素材'), button('从素材库添加', () => setMaterialsOpen(true), locked || dirty),
          ...p.assets.map(a => h('div', { key: a.id }, h('strong', null, `${a.title}${a.status ? ' · ' + a.status : ''}`), a.error ? h('p', { role: 'alert' }, a.error) : null, a.status === 'failed' ? button('恢复素材任务', () => perform(() => action('asset-resume', { asset_id: a.id })), locked || dirty) : null, a.url ? h('img', { className: 'elysium-shot-reference', src: a.url, alt: a.title }) : null)),
          h(Field, { label: 'AI 参考图描述', rows: 3, value: imagePrompt, change: setImagePrompt }), button('生成并添加参考图', () => perform(() => action('asset-generate', { prompt: imagePrompt })), locked || !imagePrompt.trim() || dirty)),
        h('h2', null, '段内分镜'), button(s.shots.length ? '重新生成分镜信息' : '生成分镜信息', () => generate('shots', s.id, true), busy || dirty),
        h(Rail, { label: '分镜', items: s.shots, describe: shot => shot.action, current: shot => `${shot.start.toFixed(1)}～${(shot.start + shot.duration).toFixed(1)} 秒`, open: shot => go({ type: 'shot', id: s.id, shotId: shot.id }) }))
      footer = h('div', null, button('保存片段信息', () => perform(() => action('segment', { segment_id: s.id, patch: draft })), locked || !dirty), button('下一步：生成当前片段 H3 输入', () => generate('inputs', s.id, true), busy || dirty))
    } else if (page.type === 'shot' && draft) {
      title = '分镜编辑与审核'; content = h(ShotEditor, { value: draft, change }); footer = button('保存并审核分镜', () => perform(() => action('shots', { segment_id: s.id, shots: s.shots.map(v => v.id === draft.id ? draft : v) }), { type: 'segment', id: s.id }), locked || !dirty)
    } else if (page.type === 'input' && s && draft) {
      title = `${s.title} · H3 输入`; content = h('div', { className: 'elysium-production-form' }, h('p', null, `${s.duration} 秒 · ${p.aspect_ratio} · 实际提交采用此版本`), h(Field, { label: '最终 H3 Prompt', rows: 18, value: draft.prompt, change: v => change({ ...draft, prompt: v }) }),
        s.use_previous_tail ? h('section', { className: 'elysium-edit-section' }, h('h3', null, '首帧来源：上一段尾帧'), h('p', null, `使用「${p.segments[p.segments.indexOf(s) - 1]?.title}」的尾帧；批量提交时自动等待，单段提交需上一段已有审核视频。`)) : null,
        h('p', null, `实际模型：${inputFor(s)?.model?.model || '当前服务模型'}`), h('p', null, inputFor(s)?.model?.note || ''), h('p', null, '指定素材的文字描述会写入 Prompt；当前仅首帧参考图作为图像条件，其余图片不直接注入模型。'), ...(inputFor(s)?.references || []).map(a => h('p', { key: a.id }, `${a.title} · ${a.usage === 'first_frame' ? '实际首帧图' : '文字描述参考'}`)), h('p', null, `生成模式：${draft.mode}；参考图：${s.use_previous_tail ? '上一段尾帧（执行时自动提取）' : draft.reference_asset_id ? p.assets.find(a => a.id === draft.reference_asset_id)?.title : '无（文字生成）'}`),
        button('返回片段修改素材与分镜', () => go({ type: 'segment', id: s.id }), busy))
      footer = h('div', null, button('保存 H3 输入', () => perform(() => action('input', { segment_id: s.id, ...draft })), locked || !dirty), button('提交当前 Segment', () => perform(() => action('submit', { segment_id: s.id })), locked || dirty || !inputFor(s)), button('重新生成当前 Segment', () => restartAction('submit', { segment_id: s.id, regenerate: true }), busy || dirty))
    } else if (page.type === 'video' && s) {
      title = `${s.title} · 视频版本`; content = h('div', null, s.tail_stale ? h('p', { role: 'status' }, '上一段已变化，请重新生成以更新尾帧衔接。') : null, ...s.generations.slice().reverse().map(g => h('section', { key: g.id, className: 'elysium-edit-section' }, h('h3', null, `${videoStatus(g)} · ${g.id.slice(-6)}${g.id === s.selected_generation ? ' · 已采用' : ''}`), g.status === 'succeeded' ? h('video', { controls: true, preload: 'none', src: assetUrl('video', g.job_id) }) : h('p', null, g.error || '等待处理'), g.first_frame ? h('div', null, h('p', null, `本次首帧来自上一段视频 ${g.first_frame.generation_id.slice(-6)}`), h('img', { className: 'elysium-shot-reference', src: g.first_frame.url, alt: '本次生成使用的上一段尾帧' })) : null, button('采用这个版本', () => perform(() => action('select-video', { segment_id: s.id, generation_id: g.id })), busy || g.status !== 'succeeded'))))
      footer = h('div', null, button('修改片段重新制作', () => go({ type: 'segment', id: s.id }), busy), button('重新生成当前 Segment', () => restartAction('submit', { segment_id: s.id, regenerate: true }), busy))
    } else if (page.type === 'compose') {
      title = '完整成片'; content = composeForm
      footer = h('div', null, button(composing ? '正在自动合片…' : '执行', submitComposition, composeDisabled), button('重新合片', () => restartAction('compose', { episode_count: episodeCount }), busy))
    } else if (page.type === 'export') {
      const output = p.exports.find(e => e.id === page.id)
      title = output?.title || '成片详情'
      content = output ? h('div', null, h('p', null, exportStatus(output)), h('p', null, `本批共 ${output.episode_count || 1} 集 · ${new Date(output.created_at).toLocaleString()}`),
        output.url ? h('video', { controls: true, preload: 'metadata', src: output.url }) : h('p', { role: output.error ? 'alert' : 'status' }, output.error || '完成后将自动展示视频')) : h('p', null, '成片不存在')
      footer = output ? h(ExportDownload, { key: output.id, project, output }) : null
    } else content = h('p', null, '加载中…')
    return h('div', { className: 'elysium-project-workflow elysium-step-detail elysium-series-workflow' },
      h('header', { className: 'elysium-app-navbar' }, page.type !== 'overview' ? button(page.type === 'shot' ? '‹ 返回片段' : '‹ 返回项目总览', () => go(page.type === 'shot' ? { type: 'segment', id: page.id } : { type: 'overview' }), busy) : null, h('h1', null, title), currentFlow ? h('span', { className: 'elysium-current-flow', role: 'status' }, currentFlow) : null, railToggle),
      h('div', { className: 'elysium-step-detail-body', key: `${page.type}-${page.id || ''}` }, error ? h('p', { role: 'alert' }, error) : null, notice ? h('p', { role: 'status' }, notice) : null,
        p.queue && (p.queue.error || ['running', 'paused', 'stopping', 'failed', 'interrupted'].includes(p.queue.status)) ? h('div', { className: 'elysium-generating-notice' }, `队列 ${statuses.videos.status} · ${p.queue.cursor}/${p.queue.items.length}`, p.queue.error ? h('p', { role: 'alert' }, p.queue.error) : null,
          p.queue.status === 'paused' ? button('继续队列', () => perform(() => action('resume')), busy) : null, ['running', 'paused'].includes(p.queue.status) ? button('结束剩余队列', () => perform(() => action('cancel-queue')), busy) : null) : null, content),
      footer ? h('footer', { className: 'elysium-step-detail-footer' }, footer) : null,
      materialsOpen ? h(Dialog, { title: '添加项目共享素材', close: () => setMaterialsOpen(false) }, h(MaterialList, { onSelect: item => { perform(() => action('asset-import', { asset_id: item.id })); setMaterialsOpen(false) } })) : null)
  }
  return { ProjectWorkflow }
} })
