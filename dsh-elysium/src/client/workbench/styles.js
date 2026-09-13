// 职责：注入项目与素材工作台的布局和交互样式。
window.__ModuleLoader__.load('elysium/workbench-styles', (require, exports) => {
  exports.apply = () => {
    const style = document.createElement('style')
    style.textContent = `
.elysium-panel { position: fixed; top: 52px; right: 0; bottom: 0; z-index: 100; display: flex; flex-direction: column; box-sizing: border-box; background: var(--dsw-alias-background-primary, #202020); color: var(--dsw-alias-label-primary, #eee); border-left: 1px solid #8885; font: 13px/1.5 system-ui; }
.elysium-panel-header { display: flex; padding: 10px; gap: 6px; border-bottom: 1px solid #8885; }
.elysium-panel-body { overflow: auto; flex: 1; padding: 12px; }
.elysium-panel-toggle { position: fixed; right: 16px; top: 12px; z-index: 101; }
.elysium-panel button, .elysium-panel-toggle { border: 1px solid #8885; border-radius: 6px; padding: 5px 8px; background: var(--dsw-alias-background-primary, #303030); color: inherit; cursor: pointer; }
.elysium-panel button:disabled { opacity: .5; cursor: wait; }
.elysium-asset-item { padding: 10px 0; border-bottom: 1px solid #8884; overflow-wrap: anywhere; }
.elysium-panel a { color: #8bcaff; }
.elysium-panel input, .elysium-panel textarea { box-sizing: border-box; width: 100%; margin: 4px 0; background: transparent; color: inherit; border: 1px solid #8887; padding: 5px; }
.elysium-panel-actions { display: flex; gap: 4px; flex-wrap: wrap; }

.elysium-panel { inset:0; width:100%; z-index:1000; font:14px/1.5 system-ui; }
.elysium-panel-header { flex:none; align-items:center; height:56px; box-sizing:border-box; padding:10px 24px; }
.elysium-panel-header strong { margin-right:24px; }
.elysium-return { margin-left:auto; }
.elysium-panel-body { min-height:0; padding:16px 24px; display:flex; flex-direction:column; overflow:hidden; }
.elysium-dialog-backdrop { position:fixed; inset:0; z-index:1100; background:#0009; display:grid; place-items:center; padding:16px; }
.elysium-dialog { background:var(--dsw-alias-background-primary,#202020); border:1px solid #8886; border-radius:12px; width:min(960px,100%); max-height:90dvh; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 16px 64px #0006; }
.elysium-dialog header,.elysium-dialog footer { flex:none; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:16px; }
.elysium-dialog h2 { margin:0; font-size:18px; }
.elysium-dialog-body { overflow:auto; min-height:0; padding:16px; }
.elysium-panel button,.elysium-panel input,.elysium-panel select { min-height:36px; }
.elysium-panel :focus-visible { outline:2px solid #8bcaff; outline-offset:2px; }
.elysium-panel [aria-selected=true] { background:#73adcf22; color:#8bcaff; }

.elysium-panel-body:has(.elysium-storyboard) { overflow:hidden; display:flex; flex-direction:column; }
.elysium-project-detail,.elysium-project-content { min-height:0; display:flex; flex-direction:column; flex:1; gap:8px; }
.elysium-project-detail > button { align-self:flex-start; }
.elysium-project-content > [role=tablist] { display:flex; gap:8px; flex:none; }
.elysium-storyboard { min-height:0; flex:1; display:grid; grid-template-columns:176px minmax(0,1fr) 360px; gap:16px; }
.elysium-acts { overflow:auto; display:flex; flex-direction:column; gap:8px; }
.elysium-acts button { text-align:left; }
.elysium-shot-list { min-height:0; display:flex; flex-direction:column; overflow:hidden; }
.elysium-toolbar { display:flex; gap:8px; align-items:center; flex-wrap:wrap; padding:8px 0; flex:none; }
.elysium-toolbar input { width:180px; }
.elysium-toolbar label { font-size:12px; }
.elysium-toolbar select { display:block; max-width:140px; }
.elysium-shot-rows { overflow:auto; min-height:0; flex:1; }
.elysium-panel .elysium-shot-row { display:grid; grid-template-columns:32px 24px 64px minmax(0,1fr) 52px; gap:8px; align-items:center; text-align:left; width:100%; height:56px; border:0; border-bottom:1px solid #8883; border-radius:0; }
.elysium-shot-summary { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.elysium-panel [aria-pressed=true] { background:#73adcf22; box-shadow:inset 3px 0 #8bcaff; }
.elysium-shot-detail { min-height:0; overflow:auto; border-left:1px solid #8883; padding:0 16px; overflow-wrap:anywhere; }
.elysium-shot-detail h2 { font-size:18px; }
.elysium-shot-detail p { white-space:pre-wrap; }
.elysium-panel .elysium-workbench-preview { display:block; width:100%; max-height:420px; object-fit:contain; background:#111; margin:12px 0; }
.elysium-pagination { display:flex; gap:8px; align-items:center; padding:12px 0; flex-wrap:wrap; flex:none; }
.elysium-empty { text-align:center; padding:40px 16px; color:#999; }
.elysium-field { display:block; margin-bottom:16px; }
.elysium-field span { display:block; margin-bottom:4px; }
.elysium-field select { width:100%; }
.elysium-panel .elysium-primary { background:#8bcaff; color:#14232d; border-color:transparent; }
@media(max-width:1279px) { .elysium-storyboard { grid-template-columns:minmax(0,1fr) 320px; } .elysium-acts { display:none; } }
@media(max-width:959px) { .elysium-storyboard { grid-template-columns:minmax(0,1fr); } .elysium-shot-detail { display:none; } .elysium-storyboard.has-selection .elysium-shot-list { display:none; } .elysium-storyboard.has-selection .elysium-shot-detail { display:block; } }
@media(max-width:600px) { .elysium-panel-header { padding:8px; gap:4px; } .elysium-panel-header strong { margin-right:4px; } .elysium-panel-body { padding:8px; } .elysium-panel button { min-height:44px; } .elysium-toolbar input { width:100%; } .elysium-shot-row { font-size:12px; } }

.elysium-materials { display:flex; flex-direction:column; min-height:0; height:100%; }
.elysium-material-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:16px; overflow:auto; align-content:start; min-height:0; flex:1; }
.elysium-material-card { border:1px solid #8883; border-radius:10px; padding:12px; min-width:0; display:flex; flex-direction:column; gap:8px; }
.elysium-material-card > img,.elysium-card-open img { width:100%; height:180px; object-fit:contain; background:#111; border-radius:6px; }
.elysium-panel .elysium-card-open { padding:0; border:0; text-align:left; }
.elysium-card-open strong,.elysium-two-lines { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; overflow-wrap:anywhere; }
.elysium-card-open strong { height:42px; margin-top:8px; }
.elysium-video-placeholder { height:180px; background:#8881; border-radius:6px; display:flex; flex-direction:column; align-items:center; justify-content:center; color:#aaa; font-size:24px; }
.elysium-video-placeholder small { font-size:12px; }
.elysium-material-card > small { color:#aaa; }
.elysium-dialog-body .elysium-materials { height:min(600px,65dvh); }
.elysium-anchor-view { min-height:0; flex:1; display:flex; flex-direction:column; overflow:hidden; }
.elysium-project-home { overflow:auto; min-height:0; }
@media(max-width:600px) { .elysium-material-grid { grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:8px; } }

.elysium-project-heading { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.elysium-panel h1 { font-size:20px; margin:8px 0; }
.elysium-panel h2 { font-size:18px; margin:8px 0; }
.elysium-project-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:16px; }
.elysium-delivery { display:grid; grid-template-columns:minmax(0,1fr) 320px; gap:24px; overflow:auto; }
.elysium-panel .elysium-delivery-preview .elysium-workbench-preview { max-height:65dvh; }
.elysium-asset-item a { display:inline-block; margin:8px; }
.elysium-panel details { margin-top:8px; }
.elysium-panel summary { cursor:pointer; min-height:36px; }
.elysium-panel details button { margin:4px; }
@media(max-width:959px) { .elysium-delivery { grid-template-columns:minmax(0,1fr); } }
@media(prefers-reduced-motion:reduce) { .elysium-panel * { animation:none !important; transition:none !important; } }

.elysium-panel { color-scheme:inherit; scrollbar-color:#666 transparent; }
.elysium-panel select { border:1px solid #8885; border-radius:6px; background:var(--dsw-alias-background-primary,#292929); color:inherit; padding:4px; }
.elysium-mobile-act { display:none; }
@media(max-width:1279px) { .elysium-mobile-act { display:inline-block; } }
`
    document.head.appendChild(style)
    return () => style.remove()
  }
})
