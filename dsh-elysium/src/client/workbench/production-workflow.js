// 职责：编排七步创作导航、人工审核、单段/全片提交与时间线导出。
window.__ModuleLoader__.load({ id: 'elysium/production-workflow', factory: require => {
  const { createElement: h, useState, useEffect } = require('react')
  const { workflowAction } = require('elysium/project-api'), { Rail, Step, inputFor, videoFor } = require('elysium/production-ui')
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
    const generate = (stage, id) => perform(() => require('elysium/project-generation').generateProduction(project, stage, id))
    if (!p) return h('div', { className: 'elysium-series-empty' }, h('h2', null, project.title), h('p', null, '此项目使用旧剧集结构。保留原始数据，使用旧剧情重新规划 Scene 和 Segment。'), h('button', { disabled: busy, onClick: () => perform(() => action('initialize')) }, '开始新流程'))
    const stages = { description: '创作要求', story: '剧情', segments: '片段规划', shots: '分镜', inputs: 'H3 输入', videos: '视频' }
    const locked = busy || !!p.request || ['running', 'paused', 'stopping'].includes(p.queue?.status)
    const storySeconds = p.story.scenes.reduce((n, scene) => n + scene.duration, 0), storyMismatch = Math.abs(storySeconds - p.target_seconds) > .05
    const count = p.segments.length, shotsReady = p.segments.filter(s => s.shots_revision === s.revision && s.shots.length).length, inputsReady = p.segments.filter(s => inputFor(s)).length, videosReady = p.segments.filter(s => !s.tail_stale && inputFor(s) && videoFor(s)?.url && (videoFor(s).input_id === inputFor(s).id || s.selected_for_input === inputFor(s).id)).length
    const rail = (label, items, type, describe, current) => h(Rail, { label, items, describe, current, open: item => go({ type, id: item.id }) })
    const button = (label, fn, disabled = locked) => h('button', { disabled, onClick: fn }, label)
    const composing = p.exports.some(e => ['pending', 'running'].includes(e.status))
    const exportStatus = e => ({ pending: '等待合片', running: '合片中', succeeded: '已完成', failed: '合片失败' }[e.status] || e.status)
    const composeForm = h('div', { className: 'elysium-production-form' },
      h(Field, { label: '总集数', type: 'number', value: episodeCount, change: setEpisodeCount }),
      h('p', null, `共 ${count} 个片段，按剧情顺序完整拼接，保留原声音。`),
      Number.isInteger(episodeCount) && episodeCount >= 1 && episodeCount <= count ? h('p', null, `预计每集约 ${(p.segments.reduce((n, s) => n + (videoFor(s)?.duration || s.duration), 0) / episodeCount).toFixed(1)} 秒；实际按完整片段边界分配。`) : h('p', { role: 'alert' }, `总集数须为 1～${count || 1} 的整数`))
    const composeDisabled = locked || composing || !count || videosReady !== count || p.story.stale || p.segments.some(s => s.story_stale) || !Number.isInteger(episodeCount) || episodeCount < 1 || episodeCount > count
    const submitComposition = () => perform(() => action('compose', { episode_count: episodeCount }), { type: 'overview' })
    let content, footer, title = project.title
    if (page.type === 'overview') content = h('div', { className: 'elysium-series-overview' },
      h(Step, { number: 1, title: '项目描述', next: '下一步：生成剧情', disabled: locked, action: () => generate('story') }, h('p', { className: 'elysium-original-request' }, p.original_request), h('p', null, `${p.aspect_ratio} · ${p.target_seconds} 秒 · ${p.style || '风格由 AI 规划'}`), h(require('elysium/project-generation').StoryModel, { sessionId: project.chat_session_id }), button('编辑创作要求', () => go({ type: 'description' }), busy)),
      h(Step, { number: 2, title: '生成剧情', next: '下一步：规划 Segment', disabled: locked || !p.story.scenes.length || p.story.stale || storyMismatch, progress: `目标 ${p.target_seconds} 秒 · 剧情 ${storySeconds} 秒`, action: () => generate('segments') }, p.story.stale || p.story.scenes.length && storyMismatch ? h('p', { role: 'alert' }, '创作要求或总时长不一致，请重新生成剧情') : null, h('p', null, p.story.text), rail('Scene', p.story.scenes, 'scene', a => a.description, a => `${a.duration} 秒`)),
      h(Step, { number: 3, title: '视频片段 Segment', next: '下一步：生成全部分镜', disabled: locked || !count || p.segments.some(s => s.story_stale), action: () => generate('shots'), progress: `${count} 段 · ${p.segments.reduce((n, s) => n + s.duration, 0)} 秒` }, rail('Segment', p.segments, 'segment', s => s.description, s => `${s.duration} 秒 · ${s.character_count || 0} 位人物${s.use_previous_tail ? ' · 沿用上一段尾帧' : ''}`)),
      h(Step, { number: 4, title: '分镜与素材审核', next: '下一步：生成全部 H3 输入', disabled: locked || !count || shotsReady !== count, action: () => generate('inputs'), progress: `分镜完成 ${shotsReady}/${count}` }, rail('片段分镜', p.segments, 'segment', s => s.shots[0]?.action || '进入片段编辑资料、生成分镜', s => `${s.shots.length} 镜${s.shots_revision !== s.revision ? ' · 待更新' : ''}`)),
      h(Step, { number: 5, title: 'H3 输入结果', next: '提交全部待生成片段', disabled: locked || !count || inputsReady !== count, action: () => perform(() => action('submit')), progress: `输入完成 ${inputsReady}/${count} · 点击即审核通过并依次生成` }, rail('H3 输入', p.segments, 'input', s => (s && inputFor(s))?.plan.prompt || '待生成', s => inputFor(s) ? '可审核' : '未就绪')),
      h(Step, { number: 6, title: 'Segment 视频', next: '下一步：自动合片', disabled: busy || !count || videosReady !== count, action: () => go({ type: 'compose' }), progress: `已审核视频 ${videosReady}/${count}` }, rail('视频', p.segments, 'video', s => s.tail_stale ? '上一段已变化，请重新生成以更新尾帧衔接' : videoFor(s)?.url ? '点击播放、选择版本或重新制作' : s.generations.at(-1)?.error || '等待生成', s => s.tail_stale ? '衔接待更新' : s.generations.at(-1)?.status || '未生成')),
      h(Step, { number: 7, title: '完整成片', next: composing ? '正在自动合片…' : '自动合片', disabled: composeDisabled, action: submitComposition }, composeForm,
        rail('成片', p.exports.slice().sort((a, b) => b.created_at - a.created_at || (a.episode_number || 1) - (b.episode_number || 1)), 'export', e => e.error || `${e.timeline.clips.length} 个片段 · ${(e.duration || e.planned_duration || e.timeline.clips.reduce((n, c) => n + c.end - c.start, 0)).toFixed(1)} 秒`, e => `${e.title || '历史成片'} · ${exportStatus(e)}`)))
    else if (page.type === 'description' && draft) {
      title = '项目描述'; content = h('div', { className: 'elysium-production-form' }, h('p', null, `原始需求：${p.original_request}`), h(Field, { label: '创作要求', rows: 7, value: draft.requirements, change: v => change({ ...draft, requirements: v }) }),
        h(Field, { label: '风格', rows: 3, value: draft.style, change: v => change({ ...draft, style: v }) }), h(Field, { label: '目标总时长（秒）', type: 'number', value: draft.target_seconds, change: v => change({ ...draft, target_seconds: v }) }),
        h('label', { className: 'elysium-field' }, '画幅', h('select', { 'aria-label': '画幅', value: draft.aspect_ratio, onChange: e => change({ ...draft, aspect_ratio: e.target.value }) }, ['9:16', '16:9', '1:1', '3:4', '4:3', '21:9'].map(v => h('option', { key: v }, v)))))
      footer = button('保存创作要求', () => perform(() => action('description', draft)), locked || !dirty)
    } else if (page.type === 'scene' && draft) {
      title = draft.title; content = h('div', { className: 'elysium-production-form' }, ...[['title', '场景标题', 0], ['description', '场景剧情', 8], ['location', '地点', 0], ['time', '故事时间', 0], ['duration', '预计时长', 0]].map(([key, label, rows]) => h(Field, { key, label, rows, type: key === 'duration' ? 'number' : 'text', value: draft[key], change: v => change({ ...draft, [key]: v }) })))
      footer = button('保存 Scene', () => perform(() => action('story', { text: p.story.scenes.map(v => v.id === draft.id ? draft.description : v.description).join('\n\n'), scenes: p.story.scenes.map(v => v.id === draft.id ? draft : v) })), locked || !dirty)
    } else if (page.type === 'segment' && s && draft) {
      title = s.title; content = h('div', null, h(SegmentEditor, { value: draft, assets: p.assets, scenes: p.story.scenes, previous: p.segments[p.segments.indexOf(s) - 1], change }),
        h('section', { className: 'elysium-edit-section' }, h('h3', null, '项目共享素材'), button('从素材库添加', () => setMaterialsOpen(true), locked || dirty),
          ...p.assets.map(a => h('div', { key: a.id }, h('strong', null, `${a.title}${a.status ? ' · ' + a.status : ''}`), a.error ? h('p', { role: 'alert' }, a.error) : null, a.status === 'failed' ? button('恢复素材任务', () => perform(() => action('asset-resume', { asset_id: a.id })), locked || dirty) : null, a.url ? h('img', { className: 'elysium-shot-reference', src: a.url, alt: a.title }) : null)),
          h(Field, { label: 'AI 参考图描述', rows: 3, value: imagePrompt, change: setImagePrompt }), button('生成并添加参考图', () => perform(() => action('asset-generate', { prompt: imagePrompt })), locked || !imagePrompt.trim() || dirty)),
        h('h2', null, '段内分镜'), button('生成分镜信息', () => generate('shots', s.id), locked || dirty),
        h(Rail, { label: '分镜', items: s.shots, describe: shot => shot.action, current: shot => `${shot.start.toFixed(1)}～${(shot.start + shot.duration).toFixed(1)} 秒`, open: shot => go({ type: 'shot', id: s.id, shotId: shot.id }) }))
      footer = h('div', null, button('保存片段信息', () => perform(() => action('segment', { segment_id: s.id, patch: draft })), locked || !dirty), button('下一步：生成当前片段 H3 输入', () => generate('inputs', s.id), locked || dirty || s.shots_revision !== s.revision))
    } else if (page.type === 'shot' && draft) {
      title = '分镜编辑与审核'; content = h(ShotEditor, { value: draft, change }); footer = button('保存并审核分镜', () => perform(() => action('shots', { segment_id: s.id, shots: s.shots.map(v => v.id === draft.id ? draft : v) }), { type: 'segment', id: s.id }), locked || !dirty)
    } else if (page.type === 'input' && s && draft) {
      title = `${s.title} · H3 输入`; content = h('div', { className: 'elysium-production-form' }, h('p', null, `${s.duration} 秒 · ${p.aspect_ratio} · 实际提交采用此版本`), h(Field, { label: '最终 H3 Prompt', rows: 18, value: draft.prompt, change: v => change({ ...draft, prompt: v }) }),
        s.use_previous_tail ? h('section', { className: 'elysium-edit-section' }, h('h3', null, '首帧来源：上一段尾帧'), h('p', null, `使用「${p.segments[p.segments.indexOf(s) - 1]?.title}」的尾帧；批量提交时自动等待，单段提交需上一段已有审核视频。`)) : null,
        h('p', null, `实际模型：${inputFor(s)?.model?.model || '当前服务模型'}`), h('p', null, inputFor(s)?.model?.note || ''), h('p', null, '指定素材的文字描述会写入 Prompt；当前仅首帧参考图作为图像条件，其余图片不直接注入模型。'), ...(inputFor(s)?.references || []).map(a => h('p', { key: a.id }, `${a.title} · ${a.usage === 'first_frame' ? '实际首帧图' : '文字描述参考'}`)), h('p', null, `生成模式：${draft.mode}；参考图：${s.use_previous_tail ? '上一段尾帧（执行时自动提取）' : draft.reference_asset_id ? p.assets.find(a => a.id === draft.reference_asset_id)?.title : '无（文字生成）'}`),
        button('返回片段修改素材与分镜', () => go({ type: 'segment', id: s.id }), busy))
      footer = h('div', null, button('保存 H3 输入', () => perform(() => action('input', { segment_id: s.id, ...draft })), locked || !dirty), button('提交当前 Segment', () => perform(() => action('submit', { segment_id: s.id })), locked || dirty || !inputFor(s)), button('重新生成当前 Segment', () => perform(() => action('submit', { segment_id: s.id, regenerate: true })), locked || dirty || !inputFor(s) || !s.generations.length))
    } else if (page.type === 'video' && s) {
      title = `${s.title} · 视频版本`; content = h('div', null, s.tail_stale ? h('p', { role: 'status' }, '上一段已变化，请重新生成以更新尾帧衔接。') : null, ...s.generations.slice().reverse().map(g => h('section', { key: g.id, className: 'elysium-edit-section' }, h('h3', null, `${g.status} · ${g.id.slice(-6)}${g.id === s.selected_generation ? ' · 已采用' : ''}`), g.status === 'succeeded' ? h('video', { controls: true, preload: 'none', src: assetUrl('video', g.job_id) }) : h('p', null, g.error || '等待处理'), g.first_frame ? h('div', null, h('p', null, `本次首帧来自上一段视频 ${g.first_frame.generation_id.slice(-6)}`), h('img', { className: 'elysium-shot-reference', src: g.first_frame.url, alt: '本次生成使用的上一段尾帧' })) : null, button('采用这个版本', () => perform(() => action('select-video', { segment_id: s.id, generation_id: g.id })), busy || g.status !== 'succeeded'))))
      footer = button('修改片段重新制作', () => go({ type: 'segment', id: s.id }), busy)
    } else if (page.type === 'compose') {
      title = '自动合片'; content = composeForm
      footer = button(composing ? '正在自动合片…' : '自动合片', submitComposition, composeDisabled)
    } else if (page.type === 'export') {
      const output = p.exports.find(e => e.id === page.id)
      title = output?.title || '成片详情'
      content = output ? h('div', null, h('p', null, exportStatus(output)), h('p', null, `本批共 ${output.episode_count || 1} 集 · ${new Date(output.created_at).toLocaleString()}`),
        output.url ? h('video', { controls: true, preload: 'metadata', src: output.url }) : h('p', { role: output.error ? 'alert' : 'status' }, output.error || '完成后将自动展示视频')) : h('p', null, '成片不存在')
      footer = output ? h(ExportDownload, { key: output.id, project, output }) : null
    } else content = h('p', null, '加载中…')
    return h('div', { className: 'elysium-project-workflow elysium-step-detail elysium-series-workflow' },
      h('header', { className: 'elysium-app-navbar' }, page.type !== 'overview' ? button(page.type === 'shot' ? '‹ 返回片段' : '‹ 返回项目总览', () => go(page.type === 'shot' ? { type: 'segment', id: page.id } : { type: 'overview' }), busy) : null, h('h1', null, title), railToggle),
      h('div', { className: 'elysium-step-detail-body', key: `${page.type}-${page.id || ''}` }, error ? h('p', { role: 'alert' }, error) : null, notice ? h('p', { role: 'status' }, notice) : null,
        p.request ? h('div', { className: 'elysium-generating-notice' }, `AI 正在生成 ${stages[p.request.stage] || p.request.stage}…`, button('取消当前生成', () => perform(() => action('cancel-request')), busy)) : null,
        p.queue && (p.queue.error || ['running', 'paused', 'stopping', 'failed'].includes(p.queue.status)) ? h('div', { className: 'elysium-generating-notice' }, `队列 ${p.queue.status} · ${p.queue.cursor}/${p.queue.items.length}`, p.queue.error ? h('p', { role: 'alert' }, p.queue.error) : null,
          p.queue.status === 'paused' ? button('继续队列', () => perform(() => action('resume')), busy) : null, ['running', 'paused'].includes(p.queue.status) ? button('结束剩余队列', () => perform(() => action('cancel-queue')), busy) : null) : null, content),
      footer ? h('footer', { className: 'elysium-step-detail-footer' }, footer) : null,
      materialsOpen ? h(Dialog, { title: '添加项目共享素材', close: () => setMaterialsOpen(false) }, h(MaterialList, { onSelect: item => { perform(() => action('asset-import', { asset_id: item.id })); setMaterialsOpen(false) } })) : null)
  }
  return { ProjectWorkflow }
} })
