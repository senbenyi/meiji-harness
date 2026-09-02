window.__ModuleLoader__.load({
  id: '@dsh-external/dsh-toonflow',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const { createElement: h, useState, useEffect, useCallback, useRef } = React
    console.log('[toonflow] client factory executing')
    const inject = []

    // ── CSS ──────────────────────────────────────────────────────────
    const styles = `
.tf-root{font-family:ui-sans-serif,system-ui,sans-serif;font-size:13px;line-height:1.5;padding:12px 14px;height:100%;overflow-y:auto;color:var(--theme-text,#e0e0e0)}
.tf-root *{box-sizing:border-box}

/* header / breadcrumb */
.tf-header{display:flex;align-items:center;gap:8px;margin-bottom:14px;min-height:28px}
.tf-back{background:none;border:none;color:var(--theme-text,#aaa);cursor:pointer;padding:2px 6px;border-radius:4px;font-size:13px;display:flex;align-items:center;gap:4px}
.tf-back:hover{background:var(--theme-input-bg,#80808020)}
.tf-title{font-size:15px;font-weight:600;flex:1}
.tf-subtitle{font-size:12px;opacity:.65;margin-bottom:12px}

/* cards */
.tf-card{border:1px solid var(--theme-border,#80808040);border-radius:8px;padding:12px;margin-bottom:10px;cursor:pointer;transition:background .15s}
.tf-card:hover{background:var(--theme-input-bg,#80808014)}
.tf-card-head{display:flex;align-items:center;gap:8px}
.tf-card-title{font-weight:600;font-size:13px;margin-bottom:4px}
.tf-card-head .tf-card-title{flex:1}
.tf-card-meta{font-size:11px;opacity:.6}
.tf-card-static{cursor:default}
.tf-card-static:hover{background:transparent}

/* progress bar */
.tf-progress{height:6px;border-radius:3px;background:var(--theme-input-bg,#80808020);margin:6px 0;overflow:hidden}
.tf-progress-fill{height:100%;border-radius:3px;background:#4a9eff;transition:width .3s}

/* status badge */
.tf-badge{display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:500;white-space:nowrap}
.tf-badge-draft{background:#80808025;color:var(--theme-text,#aaa)}
.tf-badge-ready{background:#1565c020;color:#64b5f6}
.tf-badge-queued{background:#f57f1720;color:#ffb74d;animation:tf-pulse 1.5s infinite}
.tf-badge-done{background:#2e7d3220;color:#81c784}
.tf-badge-failed{background:#c6282820;color:#ef5350}
@keyframes tf-pulse{0%,100%{opacity:1}50%{opacity:.45}}

/* section */
.tf-section{margin-bottom:16px}
.tf-section-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.tf-section-title{font-size:12px;font-weight:600;opacity:.7;text-transform:uppercase;letter-spacing:.5px}
.tf-section-link{font-size:11px;color:#4a9eff;cursor:pointer;background:none;border:none;padding:0}
.tf-section-link:hover{text-decoration:underline}

/* thumbnail grid */
.tf-grid{display:flex;gap:8px;flex-wrap:wrap}
.tf-thumb{width:72px;border-radius:6px;overflow:hidden;text-align:center;cursor:pointer}
.tf-thumb-img{width:72px;height:72px;border-radius:6px;object-fit:cover;background:var(--theme-input-bg,#80808020);display:flex;align-items:center;justify-content:center;font-size:24px;color:var(--theme-text,#aaa)}
.tf-thumb-label{font-size:10px;margin-top:3px;opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tf-thumb-badge{position:relative}
.tf-thumb-badge .tf-badge{position:absolute;bottom:2px;right:2px;font-size:9px;padding:0 4px}

/* shot row */
.tf-shot{border:1px solid var(--theme-border,#80808030);border-radius:8px;padding:10px 12px;margin-bottom:8px}
.tf-shot-head{display:flex;align-items:baseline;gap:6px;margin-bottom:6px}
.tf-shot-num{font-weight:700;font-size:13px;color:#4a9eff;min-width:24px}
.tf-shot-desc{font-size:12px;flex:1}
.tf-shot-media{display:flex;gap:8px;margin-bottom:8px}
.tf-shot-img{width:120px;height:68px;border-radius:4px;object-fit:cover;background:var(--theme-input-bg,#80808020);display:flex;align-items:center;justify-content:center;font-size:18px;color:var(--theme-text,#666)}
.tf-shot-footer{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px}
.tf-shot-chars{opacity:.6;flex:1}
.tf-shot-error{font-size:11px;color:#ef5350;margin-top:4px}

/* action button */
.tf-btn{font:inherit;cursor:pointer;background:#4a9eff;color:#fff;border:none;border-radius:6px;padding:5px 12px;font-size:12px;white-space:nowrap;transition:opacity .15s}
.tf-btn:hover{opacity:.85}
.tf-btn:disabled{opacity:.4;cursor:not-allowed}
.tf-btn-ghost{background:transparent;border:1px solid var(--theme-border,#80808050);color:var(--theme-text,#ccc)}
.tf-btn-danger{background:transparent;border:1px solid #d33;color:#ef5350}
.tf-btn-row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}

/* detail page */
.tf-detail-split{display:flex;gap:14px}
.tf-detail-left{flex:0 0 45%;display:flex;flex-direction:column;gap:8px}
.tf-detail-right{flex:1;min-width:0}
.tf-detail-img{width:100%;aspect-ratio:16/9;border-radius:6px;object-fit:cover;background:var(--theme-input-bg,#80808020);display:flex;align-items:center;justify-content:center;font-size:28px;color:var(--theme-text,#666)}
.tf-detail-field{margin-bottom:10px}
.tf-detail-label{font-size:11px;font-weight:600;opacity:.5;text-transform:uppercase;margin-bottom:3px}
.tf-detail-label-row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.tf-detail-value{font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
.tf-detail-bar{border-top:1px solid var(--theme-border,#80808030);padding-top:10px;margin-top:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}

/* export */
.tf-export-row{display:flex;align-items:center;gap:8px;padding:6px 0;font-size:12px;border-bottom:1px solid var(--theme-border,#80808015)}
.tf-export-check{width:16px;text-align:center}
.tf-export-name{flex:1}
.tf-export-dur{opacity:.6;min-width:30px;text-align:right}
.tf-export-summary{margin:14px 0;padding:10px;background:var(--theme-input-bg,#80808010);border-radius:6px;font-size:12px;line-height:1.7}

/* empty state */
.tf-empty{text-align:center;padding:40px 20px;opacity:.5;font-size:13px}
.tf-error{margin-bottom:12px;padding:8px 10px;border:1px solid #c6282860;border-radius:6px;background:#c6282815;color:#ef5350;font-size:12px}

/* tooltip on disabled button */
.tf-btn[title]:disabled:hover{position:relative}
`

    // ── Helpers ───────────────────────────────────────────────────────
    const API = '/toonflow/api'
    async function fetchJson(path, body = {}) {
      const response = await fetch(API + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + response.status))
      return data
    }
    function mediaUrl(projectId, filePath) {
      if (!projectId || !filePath) return null
      return '/toonflow/file?project=' + encodeURIComponent(projectId) + '&path=' + encodeURIComponent(filePath)
    }
    const STATUS_MAP = {
      draft:        { label: '草稿',       cls: 'tf-badge-draft' },
      prompt_ready: { label: '就绪',       cls: 'tf-badge-ready' },
      image_queued: { label: '首帧生成中…', cls: 'tf-badge-queued' },
      image_ready:  { label: '首帧完成',   cls: 'tf-badge-done' },
      video_queued: { label: '视频生成中…', cls: 'tf-badge-queued' },
      video_ready:  { label: '完成',       cls: 'tf-badge-done' },
      failed:       { label: '失败',       cls: 'tf-badge-failed' },
    }
    function timeAgo(ts) {
      const value = typeof ts === 'number' ? ts : new Date(ts).getTime()
      if (!Number.isFinite(value)) return '未知时间'
      const sec = Math.max(0, Math.floor((Date.now() - value) / 1000))
      if (sec < 60) return '刚刚'
      const min = Math.floor(sec / 60)
      if (min < 60) return min + ' 分钟前'
      const hr = Math.floor(min / 60)
      if (hr < 24) return hr + ' 小时前'
      return Math.floor(hr / 24) + ' 天前'
    }
    function charName(id, chars) { return (chars || []).find(c => c.id === id)?.name || id }
    function sceneName(id, scenes) { return (scenes || []).find(s => s.id === id)?.name || id }

    // ── Components ───────────────────────────────────────────────────

    function StatusBadge({ status }) {
      const s = STATUS_MAP[status] || STATUS_MAP.draft
      return h('span', { className: 'tf-badge ' + s.cls }, s.label)
    }

    function ProgressBar({ done, total }) {
      const pct = total > 0 ? Math.round((done / total) * 100) : 0
      return h('div', { className: 'tf-progress' },
        h('div', { className: 'tf-progress-fill', style: { width: pct + '%' } })
      )
    }

    function ActionButton({ label, disabled, ghost, onClick, title }) {
      const cls = 'tf-btn' + (ghost ? ' tf-btn-ghost' : '')
      return h('button', { className: cls, disabled: disabled, onClick: onClick, title: title || undefined }, label)
    }

    // ── Page A: Project List ─────────────────────────────────────────

    function ProjectList({ projects, loading, busy, onSelect, onCreate, onDelete }) {
      return h('div', null,
        h('div', { className: 'tf-header' },
          h('span', { className: 'tf-title' }, 'Toonflow'),
          h(ActionButton, { label: '+ 新建', disabled: busy, onClick: onCreate }),
        ),
        loading
          ? h('div', { className: 'tf-empty' }, '正在加载…')
          : projects.length === 0
          ? h('div', { className: 'tf-empty' }, '暂无项目，点击「+ 新建」开始')
          : projects.map(p =>
            h('div', { key: p.id, className: 'tf-card', onClick: () => onSelect(p.id) },
              h('div', { className: 'tf-card-head' },
                h('div', { className: 'tf-card-title' }, p.title),
                h('button', {
                  className: 'tf-btn tf-btn-danger',
                  disabled: busy,
                  onClick: event => { event.stopPropagation(); onDelete(p) },
                }, '删除'),
              ),
              h(ProgressBar, { done: p.shotsDone, total: p.shotsTotal }),
              h('div', { className: 'tf-card-meta' },
                p.shotsDone + '/' + p.shotsTotal + ' 完成　' +
                p.characterCount + ' 角色 · ' + p.sceneCount + ' 场景 · ' +
                timeAgo(p.updatedAt)
              ),
            )
          ),
      )
    }

    // ── Page B: Dashboard ────────────────────────────────────────────

    function Dashboard({ projectId, plan, navigate }) {
      const project = plan?.project
      const chars = plan?.characters || []
      const scenes = plan?.scenes || []
      const shots = plan?.shots || []
      const done = shots.filter(s => s.status === 'video_ready').length

      if (!project) return h('div', { className: 'tf-empty' }, '项目不存在')

      return h('div', null,
        h('div', { className: 'tf-header' },
          h('button', { className: 'tf-back', onClick: () => navigate('list') }, '← 返回'),
          h('span', { className: 'tf-title' }, project.title),
        ),

        // characters
        h('div', { className: 'tf-section' },
          h('div', { className: 'tf-section-head' },
            h('span', { className: 'tf-section-title' }, '角色 (' + chars.length + ')'),
          ),
          h('div', { className: 'tf-grid' },
            chars.map(c =>
              h('div', { key: c.id, className: 'tf-thumb' },
                c.imagePath
                  ? h('img', { className: 'tf-thumb-img', src: mediaUrl(projectId, c.imagePath), alt: c.name })
                  : h('div', { className: 'tf-thumb-img' }, '👤'),
                h('div', { className: 'tf-thumb-label' }, c.name),
                !c.imagePath
                  ? h(ActionButton, { label: '生成图', disabled: true, title: '即将支持：生成角色参考图', ghost: true })
                  : null,
              )
            ),
          ),
        ),

        // scenes
        h('div', { className: 'tf-section' },
          h('div', { className: 'tf-section-head' },
            h('span', { className: 'tf-section-title' }, '场景 (' + scenes.length + ')'),
          ),
          h('div', { className: 'tf-grid' },
            scenes.map(s =>
              h('div', { key: s.id, className: 'tf-thumb' },
                s.imagePath
                  ? h('img', { className: 'tf-thumb-img', src: mediaUrl(projectId, s.imagePath), alt: s.name })
                  : h('div', { className: 'tf-thumb-img' }, '🏞'),
                h('div', { className: 'tf-thumb-label' }, s.name),
              )
            ),
          ),
        ),

        // shots overview
        h('div', { className: 'tf-section' },
          h('div', { className: 'tf-section-head' },
            h('span', { className: 'tf-section-title' }, '分镜 (' + shots.length + ')'),
            h('button', { className: 'tf-section-link', onClick: () => navigate('shots', projectId) }, '进入分镜 →'),
          ),
          h('div', { className: 'tf-grid' },
            shots.map(s =>
              h('div', { key: s.id, className: 'tf-thumb tf-thumb-badge', onClick: () => navigate('shots', projectId) },
                s.imagePath
                  ? h('img', { className: 'tf-thumb-img', src: mediaUrl(projectId, s.imagePath), alt: '#' + s.order })
                  : h('div', { className: 'tf-thumb-img' }, '📷'),
                h(StatusBadge, { status: s.status }),
                h('div', { className: 'tf-thumb-label' }, '#' + s.order),
              )
            ),
          ),
          h(ProgressBar, { done: done, total: shots.length }),
          h('div', { className: 'tf-card-meta' }, done + '/' + shots.length + ' 镜头完成'),
        ),

        // action buttons
        h('div', { className: 'tf-btn-row' },
          h(ActionButton, { label: '▶ 批量生成', disabled: true, title: '即将支持：批量生成所有就绪镜头' }),
          h(ActionButton, { label: '📦 导出 MP4', disabled: true, title: '即将支持：拼接成片', ghost: true,
            onClick: () => navigate('export', projectId) }),
        ),
      )
    }

    // ── Page C: Shot Board ───────────────────────────────────────────

    function ShotBoard({ projectId, plan, navigate }) {
      const chars = plan?.characters || []
      const scenes = plan?.scenes || []
      const shots = plan?.shots || []

      function ShotActions({ shot }) {
        switch (shot.status) {
          case 'draft':
          case 'prompt_ready':
            return h(ActionButton, { label: '▶ 生成首帧', disabled: true, title: '即将支持' })
          case 'image_queued':
          case 'video_queued':
            return null // pulse animation on badge is enough
          case 'image_ready':
            return h(ActionButton, { label: '▶ 生成视频', disabled: true, title: '即将支持' })
          case 'video_ready':
            return null
          case 'failed':
            return shot.retryCount < 3
              ? h(ActionButton, { label: '🔄 重试 (' + shot.retryCount + '/3)', disabled: true, title: '即将支持' })
              : h('span', { style: { fontSize: 11, color: '#ef5350' } }, '已达重试上限')
          default:
            return null
        }
      }

      return h('div', null,
        h('div', { className: 'tf-header' },
          h('button', { className: 'tf-back', onClick: () => navigate('dashboard', projectId) }, '← 返回'),
          h('span', { className: 'tf-title' }, '分镜'),
          h(ActionButton, { label: '▶ 全部生成', disabled: true, title: '即将支持：批量生成' }),
        ),

        shots.length === 0
          ? h('div', { className: 'tf-empty' }, '暂无分镜')
          : shots.map(shot =>
            h('div', { key: shot.id, className: 'tf-shot' },
              // header
              h('div', { className: 'tf-shot-head' },
                h('span', { className: 'tf-shot-num' }, '#' + shot.order),
                h('span', { className: 'tf-shot-desc' }, shot.description),
              ),
              // media
              h('div', { className: 'tf-shot-media' },
                shot.imagePath
                  ? h('img', { className: 'tf-shot-img', src: mediaUrl(projectId, shot.imagePath), alt: '首帧' })
                  : h('div', { className: 'tf-shot-img' }, '📷'),
                shot.videoPath
                  ? h('video', { className: 'tf-shot-img', src: mediaUrl(projectId, shot.videoPath), controls: true })
                  : h('div', { className: 'tf-shot-img' }, shot.status === 'image_ready' ? '待生成' : ''),
              ),
              // footer
              h('div', { className: 'tf-shot-footer' },
                h('span', { className: 'tf-shot-chars' },
                  (shot.characterIds || []).map(id => charName(id, chars)).join(', ') +
                  ' · ' + sceneName(shot.sceneId, scenes)
                ),
                h(StatusBadge, { status: shot.status }),
                h(ShotActions, { shot: shot }),
                h('button', {
                  className: 'tf-back',
                  onClick: () => navigate('shot', projectId, { shotId: shot.id }),
                  style: { fontSize: 11 },
                }, '详情 →'),
              ),
              // error
              shot.lastError
                ? h('div', { className: 'tf-shot-error' }, '错误: ' + shot.lastError)
                : null,
            )
          ),
      )
    }

    // ── Page D: Shot Detail ──────────────────────────────────────────

    function ShotDetail({ projectId, shotId, plan, busy, navigate, onUpdate }) {
      const chars = plan?.characters || []
      const scenes = plan?.scenes || []
      const shots = plan?.shots || []
      const shot = shots.find(s => s.id === shotId)

      if (!shot) return h('div', { className: 'tf-empty' }, '镜头不存在')

      function Field({ label, value, field }) {
        return h('div', { className: 'tf-detail-field' },
          h('div', { className: 'tf-detail-label-row' },
            h('div', { className: 'tf-detail-label' }, label),
            field ? h('button', {
              className: 'tf-section-link',
              disabled: busy,
              onClick: () => {
                const next = window.prompt('编辑' + label, value || '')
                if (next !== null && next !== value) void onUpdate(shot.id, { [field]: next })
              },
            }, busy ? '保存中…' : '编辑') : null,
          ),
          h('div', { className: 'tf-detail-value' }, value || '(空)'),
        )
      }

      function DetailActions() {
        const btns = []
        switch (shot.status) {
          case 'draft':
          case 'prompt_ready':
            btns.push({ label: '▶ 生成首帧', disabled: true })
            break
          case 'image_ready':
            btns.push({ label: '▶ 生成视频', disabled: true })
            btns.push({ label: '🔄 重新生成首帧', disabled: true, ghost: true })
            break
          case 'video_ready':
            btns.push({ label: '🔄 重新生成首帧', disabled: true, ghost: true })
            btns.push({ label: '🔄 重新生成视频', disabled: true, ghost: true })
            break
          case 'failed':
            if (shot.retryCount < 3) btns.push({ label: '🔄 重试', disabled: true })
            break
        }
        return h('div', { className: 'tf-btn-row' },
          btns.map((b, i) =>
            h(ActionButton, { key: i, label: b.label, disabled: true, ghost: b.ghost, title: '即将支持' })
          ),
        )
      }

      return h('div', null,
        h('div', { className: 'tf-header' },
          h('button', { className: 'tf-back', onClick: () => navigate('shots', projectId) }, '← 返回'),
          h('span', { className: 'tf-title' }, '#' + shot.order + ' ' + shot.description),
        ),

        h('div', { className: 'tf-detail-split' },
          // left: media
          h('div', { className: 'tf-detail-left' },
            h('div', { className: 'tf-detail-label' }, '首帧'),
            shot.imagePath
              ? h('img', { className: 'tf-detail-img', src: mediaUrl(projectId, shot.imagePath), alt: '首帧' })
              : h('div', { className: 'tf-detail-img' }, '📷 待生成'),
            h('div', { className: 'tf-detail-label', style: { marginTop: 8 } }, '视频'),
            shot.videoPath
              ? h('video', { className: 'tf-detail-img', src: mediaUrl(projectId, shot.videoPath), controls: true })
              : h('div', { className: 'tf-detail-img' }, '🎬 待生成'),
          ),
          // right: fields
          h('div', { className: 'tf-detail-right' },
            h(Field, { label: '描述', value: shot.description, field: 'description' }),
            h(Field, { label: '镜头运动', value: shot.camera, field: 'camera' }),
            h(Field, { label: '角色',
              value: (shot.characterIds || []).map(id => charName(id, chars)).join(', ') }),
            h(Field, { label: '场景', value: sceneName(shot.sceneId, scenes) }),
            h(Field, { label: '图片提示词', value: shot.imagePrompt, field: 'imagePrompt' }),
            h(Field, { label: '视频提示词', value: shot.videoPrompt, field: 'videoPrompt' }),
            h(Field, { label: '时长', value: shot.durationSec + ' 秒' }),
          ),
        ),

        // bottom bar
        h('div', { className: 'tf-detail-bar' },
          h(StatusBadge, { status: shot.status }),
          shot.lastError
            ? h('span', { style: { fontSize: 11, color: '#ef5350' } }, shot.lastError)
            : null,
          shot.retryCount > 0
            ? h('span', { style: { fontSize: 11, opacity: .6 } }, '重试 ' + shot.retryCount + '/3')
            : null,
        ),
        h(DetailActions),
      )
    }

    // ── Page E: Export Panel ──────────────────────────────────────────

    function ExportPanel({ projectId, plan, navigate }) {
      const shots = plan?.shots || []
      const exportable = shots.filter(s => s.status === 'video_ready')
      const totalDur = exportable.reduce((sum, s) => sum + s.durationSec, 0)

      return h('div', null,
        h('div', { className: 'tf-header' },
          h('button', { className: 'tf-back', onClick: () => navigate('dashboard', projectId) }, '← 返回'),
          h('span', { className: 'tf-title' }, '导出'),
        ),

        shots.map(shot => {
          const ok = shot.status === 'video_ready'
          return h('div', { key: shot.id, className: 'tf-export-row' },
            h('span', { className: 'tf-export-check' }, ok ? '☑' : '☐'),
            h('span', { className: 'tf-export-name', style: { opacity: ok ? 1 : .4 } },
              '#' + shot.order + ' ' + shot.description),
            h('span', { className: 'tf-export-dur' }, ok ? shot.durationSec + 's' : '--'),
            h(StatusBadge, { status: shot.status }),
          )
        }),

        h('div', { className: 'tf-export-summary' },
          '可导出: ' + exportable.length + ' 个镜头\n' +
          '预计时长: ' + totalDur + ' 秒\n' +
          '分辨率: 1280×720　帧率: 24fps'
        ),

        h('div', { className: 'tf-btn-row' },
          h(ActionButton, { label: '📦 导出 MP4', disabled: true, title: '即将支持：FFmpeg 拼接成片' }),
        ),
      )
    }

    // ── App Root ─────────────────────────────────────────────────────

    function ToonflowApp({ ctx, tab }) {
      const meta = tab?.meta || {}
      const [view, setView] = useState(meta.view || 'list')
      const [projectId, setProjectId] = useState(meta.projectId || null)
      const [extra, setExtra] = useState(meta.extra || {})
      const [projects, setProjects] = useState([])
      const [plan, setPlan] = useState(null)
      const [loading, setLoading] = useState(true)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [revision, setRevision] = useState(0)

      useEffect(() => {
        if (view !== 'list') return
        let cancelled = false
        setLoading(true)
        setError('')
        fetchJson('/project.list')
          .then(data => { if (!cancelled) setProjects(data.projects || []) })
          .catch(reason => { if (!cancelled) setError(reason.message || String(reason)) })
          .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
      }, [view, revision])

      useEffect(() => {
        if (view === 'list' || !projectId) return
        let cancelled = false
        setLoading(true)
        setError('')
        fetchJson('/plan.get', { projectId })
          .then(data => { if (!cancelled) setPlan(data) })
          .catch(reason => { if (!cancelled) setError(reason.message || String(reason)) })
          .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
      }, [view, projectId, revision])

      const navigate = useCallback((nextView, nextProjectId, nextExtra) => {
        setView(nextView)
        if (nextProjectId !== undefined) {
          if (nextProjectId !== projectId) setPlan(null)
          setProjectId(nextProjectId)
        }
        const ex = nextExtra || {}
        setExtra(ex)
        // persist to tab.meta so refresh doesn't lose position
        try {
          ctx?.get?.('betterSidebar')?.updateTab?.(tab?.id, {
            meta: {
              view: nextView,
              projectId: nextProjectId === undefined ? projectId : nextProjectId,
              extra: ex,
            },
          })
        } catch (_) { /* sidebar might not expose updateTab in all versions */ }
      }, [ctx, tab?.id, projectId])

      const createProject = useCallback(async () => {
        const title = window.prompt('项目名称')
        if (!title?.trim()) return
        const description = window.prompt('项目简介（可选）')
        setBusy(true)
        setError('')
        try {
          await fetchJson('/project.create', { title: title.trim(), description: description || '' })
          setRevision(value => value + 1)
        } catch (reason) {
          setError(reason.message || String(reason))
        } finally {
          setBusy(false)
        }
      }, [])

      const deleteProject = useCallback(async (project) => {
        if (!window.confirm('确认删除项目「' + project.title + '」？项目文件和资产会一并删除。')) return
        setBusy(true)
        setError('')
        try {
          await fetchJson('/project.delete', { projectId: project.id })
          setProjects(current => current.filter(item => item.id !== project.id))
        } catch (reason) {
          setError(reason.message || String(reason))
        } finally {
          setBusy(false)
        }
      }, [])

      const updateShot = useCallback(async (shotId, updates) => {
        setBusy(true)
        setError('')
        try {
          const data = await fetchJson('/plan.update_shot', { projectId, shotId, updates })
          setPlan(current => current ? {
            ...current,
            project: data.project || current.project,
            summary: data.summary || current.summary,
            shots: current.shots.map(shot => shot.id === shotId ? data.shot : shot),
          } : current)
        } catch (reason) {
          setError(reason.message || String(reason))
        } finally {
          setBusy(false)
        }
      }, [projectId])

      const currentPlan = plan?.project?.id === projectId ? plan : null
      let page = null
      if (view !== 'list' && loading && !currentPlan) {
        page = h('div', { className: 'tf-empty' }, '正在加载…')
      } else switch (view) {
        case 'list':
          page = h(ProjectList, {
            projects, loading, busy,
            onSelect: id => navigate('dashboard', id),
            onCreate: createProject,
            onDelete: deleteProject,
          })
          break
        case 'dashboard':
          page = h(Dashboard, { projectId, plan: currentPlan, navigate })
          break
        case 'shots':
          page = h(ShotBoard, { projectId, plan: currentPlan, navigate })
          break
        case 'shot':
          page = h(ShotDetail, {
            projectId, shotId: extra.shotId, plan: currentPlan, busy, navigate, onUpdate: updateShot,
          })
          break
        case 'export':
          page = h(ExportPanel, { projectId, plan: currentPlan, navigate })
          break
        default:
          page = h(ProjectList, {
            projects, loading, busy,
            onSelect: id => navigate('dashboard', id),
            onCreate: createProject,
            onDelete: deleteProject,
          })
      }

      return h('div', { className: 'tf-root' },
        h('style', null, styles),
        error ? h('div', { className: 'tf-error' }, error) : null,
        page,
      )
    }

    // ── Tab Icon ─────────────────────────────────────────────────────

    function ToonflowIcon({ size }) {
      return h('svg', {
        width: size || 16, height: size || 16, viewBox: '0 0 16 16',
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
      },
        // clapperboard icon
        h('rect', { x: 2, y: 5, width: 12, height: 9, rx: 1.5 }),
        h('path', { d: 'M2 5l3-3h6l3 3' }),
        h('path', { d: 'M5.5 2L7 5' }),
        h('path', { d: 'M10.5 2L9 5' }),
      )
    }

    // ── Plugin Registration ──────────────────────────────────────────

    function apply(ctx) {
      console.log('[toonflow] apply() called')
      try {
        ctx.inject(['betterSidebar'], (sctx) => {
          console.log('[toonflow] betterSidebar service available, registering tab')
          sctx.effect(() => {
            const firstLeaf = (node) => node.kind === 'leaf' ? node : firstLeaf(node.children[0])

            const findTab = (node, tabId) => {
              if (node.kind === 'leaf') return node.tabs.find(tab => tab.id === tabId)
              for (const child of node.children) {
                const found = findTab(child, tabId)
                if (found) return found
              }
              return undefined
            }

            const removeTab = (node, tabId) => {
              if (node.kind === 'leaf') {
                const tabs = node.tabs.filter(tab => tab.id !== tabId)
                if (tabs.length === node.tabs.length) return node
                const active = tabs.some(tab => tab.id === node.active)
                  ? node.active
                  : (tabs[tabs.length - 1]?.id || null)
                return { ...node, tabs, active }
              }
              const children = node.children.map(child => removeTab(child, tabId))
              return children.some((child, index) => child !== node.children[index])
                ? { ...node, children }
                : node
            }

            const appendTab = (node, paneId, tab) => {
              if (node.kind === 'leaf') {
                return node.id === paneId
                  ? { ...node, tabs: [...node.tabs, tab], active: tab.id }
                  : node
              }
              const children = node.children.map(child => appendTab(child, paneId, tab))
              return children.some((child, index) => child !== node.children[index])
                ? { ...node, children }
                : node
            }

            const dispose = sctx.betterSidebar.registerTab({
              id: 'toonflow',
              title: 'Toonflow',
              icon: (size) => h(ToonflowIcon, { size }),
              order: 60,
              single: true,
              createTab: (state) => {
                const existing = findTab(state.splits, 'toonflow')
                  || findTab(state.bottomSplits, 'toonflow')
                  || state.floats?.find(item => item.tab.id === 'toonflow')?.tab
                const tab = existing || { id: 'toonflow', type: 'toonflow', title: 'Toonflow' }
                const cleanSplits = removeTab(state.splits, 'toonflow')
                const cleanBottomSplits = removeTab(state.bottomSplits, 'toonflow')
                const target = firstLeaf(cleanSplits)

                return {
                  tab,
                  patch: {
                    splits: appendTab(cleanSplits, target.id, tab),
                    bottomSplits: cleanBottomSplits,
                    floats: state.floats?.filter(item => item.tab.id !== 'toonflow') || [],
                    activePane: target.id,
                    panelOpen: true,
                  },
                }
              },
              component: (props) => h(ToonflowApp, props),
            })
            console.log('[toonflow] tab registered')

            // The sidebar state may not have an active session yet. Open once
            // it is ready; createTab pins placement to the right split tree.
            let opened = false
            let unsubscribe
            const openToonflow = () => {
              if (opened || !sctx.betterSidebar.getSnapshot().state) return
              opened = true
              sctx.betterSidebar.openTab({ type: 'toonflow' })
              unsubscribe?.()
              unsubscribe = undefined
            }
            unsubscribe = sctx.betterSidebar.subscribeState(openToonflow)
            openToonflow()

            return () => {
              unsubscribe?.()
              dispose()
            }
          },
            'dsh-toonflow: sidebar tab'
          )
        })
      } catch (err) {
        console.error('[toonflow] registration failed:', err)
      }
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
