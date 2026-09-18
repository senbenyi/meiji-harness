// 职责：注入项目与素材工作台的布局和交互样式。
window.__ModuleLoader__.load({ id: 'elysium/workbench-styles', factory: require => {
  const exports = {}
  exports.apply = () => {
    const style = document.createElement('style')
    style.textContent = `
.elysium-project-workflow { display:flex; flex-direction:column; gap:12px; flex:1; min-height:0; min-width:0; overflow-y:auto; overflow-x:hidden; overscroll-behavior:contain; scrollbar-gutter:stable; scrollbar-width:thin; padding:0 6px 20px 0; }
.elysium-workflow-step { flex:none; min-width:0; border:1px solid var(--dsw-alias-border-l1,#8883); border-radius:12px; padding:14px; background:var(--dsw-alias-bg-layer-2,#222); }
.elysium-panel .elysium-step-heading { display:block; width:100%; text-align:left; font-weight:600; border:0; padding:4px 0; margin:0; background:transparent; }
.elysium-panel .elysium-step-heading[aria-expanded=true] { margin-bottom:16px; padding-bottom:12px; border-bottom:1px solid var(--dsw-alias-border-l1,#8883); border-radius:0; }
.elysium-project-workflow textarea, .elysium-project-workflow select { width:100%; box-sizing:border-box; background:var(--dsw-alias-bg-layer-1,#292929); }
.elysium-project-configuration { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:18px 14px; padding-bottom:20px; }
.elysium-project-configuration > * { grid-column:1 / -1; min-width:0; margin:0; }
.elysium-project-configuration > fieldset:nth-of-type(1), .elysium-project-configuration > fieldset:nth-of-type(2) { grid-column:auto; }
.elysium-project-configuration > p { color:var(--dsw-alias-label-secondary,#aaa); font-size:12px; line-height:1.7; }
.elysium-project-configuration > h3 { font-size:13px; padding-top:4px; }
.elysium-project-configuration .elysium-field { display:flex; flex-direction:column; gap:8px; font-size:12px; font-weight:500; }
.elysium-project-configuration textarea { min-height:84px; resize:vertical; line-height:1.7; font-weight:400; }
.elysium-project-configuration select { font-weight:400; }
.elysium-project-configuration select[multiple] { min-height:116px; padding:4px; }
.elysium-project-configuration select[multiple] option { padding:6px 8px; border-radius:4px; }
.elysium-selection { padding:12px; border:1px solid var(--dsw-alias-border-l1,#8883); border-radius:8px; min-width:0; }
.elysium-selection legend { padding:0 6px; font-size:12px; color:var(--dsw-alias-label-secondary,#aaa); }
.elysium-selected-materials { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:10px; margin-top:12px; }
.elysium-selected-materials article { min-width:0; padding:8px; border-radius:8px; background:var(--dsw-alias-bg-layer-1,#292929); font-size:12px; overflow-wrap:anywhere; }
.elysium-selected-materials img { display:block; width:100%; height:112px; object-fit:contain; border-radius:6px; margin-bottom:8px; }
.elysium-selected-materials p { margin:6px 0; color:var(--dsw-alias-label-secondary,#aaa); line-height:1.6; }
.elysium-project-workflow .elysium-primary { width:100%; margin-top:12px; min-height:40px; font-weight:600; }
@container elysium-panel (max-width:440px) { .elysium-project-configuration { grid-template-columns:minmax(0,1fr); } .elysium-workflow-step { padding:12px; } }
.elysium-shot-editor { border-top:1px solid #6666; margin:12px 0; padding-top:10px; }

.elysium-project-overview { flex:1; min-height:0; overflow-y:auto; scrollbar-width:thin; padding:2px 6px 20px 0; display:flex; flex-direction:column; gap:14px; }
.elysium-overview-hint { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:6px; margin:0 0 2px; font-weight:600; }
.elysium-overview-hint span { color:var(--dsw-alias-label-secondary,#aaa); font-size:12px; font-weight:400; }
.elysium-panel .elysium-process-card { flex:none; display:flex; flex-direction:column; gap:12px; width:100%; padding:18px; text-align:left; border-radius:14px; background:var(--dsw-alias-bg-layer-2,#222); border:1px solid var(--dsw-alias-border-l1,#8883); }
.elysium-panel .elysium-process-card:not(:disabled):hover { background:var(--dsw-alias-bg-layer-3,#303030); border-color:var(--dsw-alias-border-l2,#8886); }
.elysium-panel .elysium-process-card:disabled { opacity:.65; cursor:not-allowed; }
.elysium-process-card-heading { display:flex; align-items:center; gap:10px; width:100%; }
.elysium-process-card-heading strong { flex:1; font-size:15px; }
.elysium-step-number { display:grid; place-items:center; width:30px; height:30px; border-radius:9px; background:#8882; color:var(--dsw-alias-label-secondary,#aaa); font-size:12px; font-weight:600; }
.elysium-step-status { flex:none; padding:3px 8px; border-radius:20px; background:#8882; color:var(--dsw-alias-label-secondary,#aaa); font-size:11px; font-weight:400; }
.elysium-panel .elysium-process-card[data-current=true] { border-color:#7a91bc88; }
.elysium-process-card[data-current=true] .elysium-step-number { background:#7a91bc22; color:#adc4ed; }
.elysium-process-video { width:100%; height:140px; object-fit:contain; border-radius:8px; background:#151515; pointer-events:none; }
.elysium-process-summary { font-size:13px; }
.elysium-process-description { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; color:var(--dsw-alias-label-secondary,#aaa); font-size:12px; line-height:1.7; overflow-wrap:anywhere; }
.elysium-process-previews { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; }
.elysium-process-previews > span { min-width:0; display:flex; flex-direction:column; gap:6px; }
.elysium-process-previews img { width:100%; height:88px; object-fit:cover; object-position:top; border-radius:8px; background:#8881; }
.elysium-process-previews > span > span { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; color:var(--dsw-alias-label-secondary,#aaa); font-size:11px; }
.elysium-project-workflow.elysium-step-detail { overflow:hidden; padding:0; gap:0; scrollbar-gutter:auto; }
.elysium-step-detail-header { flex:none; display:flex; align-items:center; gap:12px; padding:0 0 12px; border-bottom:1px solid var(--dsw-alias-border-l1,#8883); }
.elysium-step-detail-header strong { flex:1; }
.elysium-step-detail-body { flex:1; min-height:0; min-width:0; overflow-y:auto; overflow-x:hidden; scrollbar-width:thin; scrollbar-gutter:stable; overscroll-behavior:contain; padding:18px 6px 20px 0; }
.elysium-step-detail-footer { flex:none; display:flex; justify-content:flex-end; gap:10px; padding:12px 0 0; border-top:1px solid var(--dsw-alias-border-l1,#8883); background:var(--dsw-alias-bg-layer-1,#292929); }
.elysium-step-detail-footer > button { min-height:40px; }
.elysium-project-workflow .elysium-step-detail-footer .elysium-primary { width:auto; flex:1; margin:0; }
.elysium-step-detail-body .elysium-field { display:flex; flex-direction:column; gap:8px; margin-bottom:14px; }
.elysium-step-detail-body .elysium-project-configuration .elysium-field { margin:0; }
.elysium-step-detail-body .elysium-delivery { grid-template-columns:minmax(0,1fr); gap:16px; }
.elysium-workflow-notices:empty { display:none; }
@container elysium-panel (max-width:440px) { .elysium-panel .elysium-process-card { padding:14px; } .elysium-step-detail-header { gap:6px; } .elysium-step-detail-footer { flex-wrap:wrap; } }

.elysium-series-workflow { container:elysium-series / inline-size; }
.elysium-app-navbar { display:flex; align-items:center; flex:none; gap:10px; min-height:48px; padding:0 0 10px; border-bottom:1px solid var(--dsw-alias-border-l1,#8883); }
.elysium-app-navbar h1 { flex:1; min-width:0; margin:0; font-size:15px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:center; }
.elysium-panel .elysium-app-navbar > button { display:flex; align-items:center; gap:6px; padding:4px 0; border:0; color:var(--dsw-alias-label-secondary,#aaa); background:transparent; font-size:12px; }
.elysium-app-navbar > button span { font-size:25px; line-height:1; }
.elysium-nav-state { min-width:40px; text-align:right; color:var(--dsw-alias-label-secondary,#aaa); font-size:11px; }
.elysium-series-workflow .elysium-step-detail-body { padding:16px 0 24px; }
.elysium-series-overview { display:flex; flex-direction:column; gap:24px; min-width:0; }
.elysium-series-intro > span { font-size:10px; letter-spacing:2px; color:var(--dsw-alias-label-tertiary,#888); }
.elysium-series-intro h2 { font-size:22px; margin:6px 0; line-height:1.4; }
.elysium-series-intro p,.elysium-list-intro p { margin:6px 0 0; font-size:12px; color:var(--dsw-alias-label-secondary,#aaa); }
.elysium-panel .elysium-series-configuration { display:flex; align-items:center; gap:12px; padding:16px; border-radius:12px; text-align:left; background:var(--dsw-alias-bg-layer-2,#222); }
.elysium-series-configuration > span:first-child { flex:1; display:flex; flex-direction:column; gap:6px; }
.elysium-series-configuration > span:first-child > span { font-size:12px; color:var(--dsw-alias-label-secondary,#aaa); }
.elysium-series-avatars { display:flex; gap:4px; }
.elysium-series-avatars img { width:32px; height:40px; border-radius:6px; object-fit:cover; object-position:top; }
.elysium-episode-section { min-width:0; border:1px solid var(--dsw-alias-border-l1,#8883); border-radius:14px; padding:16px 0 4px; background:var(--dsw-alias-bg-layer-2,#222); }
.elysium-episode-section > header { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:0 16px 12px; }
.elysium-episode-section > header > div:first-child { display:flex; align-items:center; gap:10px; }
.elysium-episode-section h2 { margin:0; font-size:15px; }
.elysium-episode-section > header span { font-size:11px; color:var(--dsw-alias-label-secondary,#aaa); }
.elysium-rail-controls { display:flex; gap:6px; }
.elysium-panel .elysium-rail-controls button { width:28px; min-height:28px; padding:0; font-size:20px; line-height:1; border-radius:7px; }
.elysium-episode-rail { display:flex; gap:12px; overflow-x:auto; overflow-y:hidden; padding:0 16px 14px; scroll-snap-type:x proximity; scroll-padding-inline:16px; overscroll-behavior-x:contain; scrollbar-width:thin; }
.elysium-panel .elysium-episode-card { display:flex; flex-direction:column; flex:0 0 216px; min-width:0; gap:8px; padding:10px; text-align:left; border-radius:11px; background:var(--dsw-alias-bg-layer-1,#292929); scroll-snap-align:start; }
.elysium-panel .elysium-episode-card:hover { border-color:#91a5c877; background:var(--dsw-alias-bg-layer-3,#303030); }
.elysium-episode-card > strong { display:-webkit-box; -webkit-line-clamp:1; -webkit-box-orient:vertical; overflow:hidden; font-size:14px; }
.elysium-episode-cover { display:block; width:100%; height:108px; border-radius:7px; object-fit:cover; background:#151515; pointer-events:none; }
video.elysium-episode-cover { object-fit:contain; }
.elysium-episode-placeholder { display:flex; align-items:center; justify-content:center; height:82px; border-radius:7px; background:linear-gradient(135deg,#7192b21a,#7192b206); font-size:32px; font-weight:300; color:#9ab1cf; }
.elysium-episode-placeholder-storyboard { background:linear-gradient(135deg,#b79d731a,#b79d7306); color:#bda77e; }
.elysium-episode-placeholder-video { background:linear-gradient(135deg,#8583b31a,#8583b306); color:#aaa3ce; }
.elysium-episode-card-top { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:11px; color:var(--dsw-alias-label-secondary,#aaa); }
.elysium-episode-excerpt { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; min-height:38px; line-height:1.6; font-size:12px; color:var(--dsw-alias-label-secondary,#aaa); }
.elysium-episode-card-meta { padding-top:8px; margin-top:auto; border-top:1px solid var(--dsw-alias-border-l1,#8883); font-size:11px; color:var(--dsw-alias-label-secondary,#aaa); }
.elysium-step-status[data-status=生成中] { background:#8daedd22; color:#adc4ed; }
.elysium-step-status[data-status=已完成] { background:#81bc9d22; color:#97c7ab; }
.elysium-step-status[data-status=生成失败],.elysium-step-status[data-status=待更新] { background:#d3a07022; color:#dfb28a; }
.elysium-episode-shots { display:flex; flex-direction:column; gap:12px; }
.elysium-list-intro { padding:0 0 10px; }
.elysium-list-intro h2 { margin:0; font-size:18px; }
.elysium-panel .elysium-episode-shot-row { display:flex; align-items:center; gap:14px; padding:14px; text-align:left; border-radius:12px; background:var(--dsw-alias-bg-layer-2,#222); }
.elysium-episode-shot-row > img,.elysium-shot-number { flex:none; width:84px; height:72px; border-radius:8px; object-fit:cover; }
.elysium-shot-number { display:grid; place-items:center; background:#8881; font-size:24px; color:var(--dsw-alias-label-tertiary,#888); }
.elysium-shot-row-copy { display:flex; flex-direction:column; gap:6px; flex:1; min-width:0; }
.elysium-shot-row-copy strong { display:flex; justify-content:space-between; gap:10px; font-size:13px; }
.elysium-shot-row-copy small { font-size:11px; font-weight:400; color:var(--dsw-alias-label-tertiary,#888); }
.elysium-shot-row-copy > span { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; color:var(--dsw-alias-label-secondary,#aaa); font-size:12px; }
.elysium-shot-form { display:flex; flex-direction:column; gap:16px; }
.elysium-edit-section { padding:18px; border:1px solid var(--dsw-alias-border-l1,#8883); border-radius:12px; background:var(--dsw-alias-bg-layer-2,#222); }
.elysium-edit-section h2 { font-size:14px; margin:0 0 18px; }
.elysium-series-workflow .elysium-field { font-size:12px; color:var(--dsw-alias-label-secondary,#aaa); }
.elysium-series-workflow textarea { resize:vertical; line-height:1.8; }
.elysium-shot-form-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:0 14px; }
.elysium-shot-form-grid > * { min-width:0; }
.elysium-plot-count { margin:0; text-align:right; font-size:11px; color:var(--dsw-alias-label-tertiary,#888); }
.elysium-shot-material-field { margin-bottom:18px; font-size:12px; color:var(--dsw-alias-label-secondary,#aaa); }
.elysium-shot-chips { display:flex; flex-wrap:wrap; gap:8px; padding-top:8px; }
.elysium-panel .elysium-shot-chips button { border-radius:8px; font-size:12px; padding:6px 10px; }
.elysium-panel .elysium-shot-chips button[aria-pressed=true] { background:#86a4cf22; border-color:#86a4cf88; color:#bed1ed; }
.elysium-shot-reference { display:block; width:100%; height:160px; object-fit:contain; border-radius:8px; background:#151515; }
.elysium-series-empty { padding:40px 20px; text-align:center; border:1px dashed var(--dsw-alias-border-l2,#8885); border-radius:12px; color:var(--dsw-alias-label-secondary,#aaa); }
.elysium-series-empty p { font-size:12px; }
.elysium-generating-notice { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px; margin-bottom:14px; background:#86a4cf11; border-radius:8px; font-size:12px; }
.elysium-series-workflow .elysium-step-detail-footer { gap:8px; }
.elysium-series-workflow .elysium-step-detail-footer button { font-size:12px; }
@container elysium-series (max-width:440px) { .elysium-shot-form-grid { grid-template-columns:minmax(0,1fr); } .elysium-edit-section { padding:14px; } .elysium-panel .elysium-episode-card { flex-basis:190px; } .elysium-app-navbar h1 { font-size:14px; } .elysium-episode-shot-row > img,.elysium-shot-number { width:62px; height:64px; } }

.elysium-panel-host { position:fixed; inset:0; z-index:25; pointer-events:none; overflow:hidden; overflow:clip; color:var(--dsw-alias-label-primary,#eee); font:13px/1.5 system-ui; }
.elysium-panel { position:absolute; top:0; left:0; bottom:0; z-index:40; display:flex; flex-direction:column; box-sizing:border-box; pointer-events:auto; contain:layout style; container:elysium-panel / inline-size; background:var(--dsw-alias-bg-layer-1,#292929); color:var(--dsw-alias-label-primary,#eee); border-right:1px solid var(--dsw-alias-border-l2,#8885); padding-bottom:env(safe-area-inset-bottom); transition:transform var(--ds-transition-duration-slow,200ms) var(--ds-ease-in-out,ease),width var(--ds-transition-duration-slow,200ms) var(--ds-ease-in-out,ease); }
.elysium-panel-header { display:flex; flex:none; min-width:0; height:34px; box-sizing:border-box; border-bottom:1px solid var(--dsw-alias-border-l1,#8883); background:var(--dsw-alias-bg-layer-1,#292929); }
.elysium-panel-header [role=tablist] { display:flex; flex:1; min-width:0; overflow-x:auto; scrollbar-width:none; }
.elysium-panel-header [role=tablist]::-webkit-scrollbar { display:none; }
.elysium-panel .elysium-panel-header button { flex:none; min-width:64px; height:33px; min-height:33px; padding:0 10px; border:0; border-right:1px solid var(--dsw-alias-border-l1,#8883); border-radius:0; background:transparent; color:var(--dsw-alias-label-secondary,#aaa); font:var(--dsw-font-xxs-12,12px/1.5 system-ui); }
.elysium-panel .elysium-panel-header button:hover { background:var(--dsw-alias-interactive-bg-hover,#8882); color:var(--dsw-alias-label-primary,#eee); }
.elysium-panel .elysium-panel-header button[aria-selected=true] { background:var(--dsw-alias-interactive-bg-active,#8883); color:var(--dsw-alias-label-primary,#eee); }
.elysium-panel-body { min-height:0; min-width:0; overflow:hidden; flex:1; padding:16px; display:flex; flex-direction:column; }
.elysium-settings { overflow-y:auto; min-height:0; flex:1; overflow-wrap:anywhere; }
.elysium-settings > h2 { margin:0 0 28px; font-size:17px; font-weight:600; }
.elysium-model-group { margin:0 0 22px; }
.elysium-model-group h3 { margin:0 0 10px; font-size:14px; font-weight:600; color:var(--dsw-alias-label-primary,#eee); }
.elysium-model-group .elysium-compact-meta { margin:4px 0 0; }
.elysium-model-group [role=radiogroup] { display:flex; flex-direction:column; gap:6px; }
.elysium-model-row { display:flex; align-items:center; gap:10px; width:100%; max-width:100%; margin:0; min-height:42px; padding:8px 12px; box-sizing:border-box; border:1px solid transparent; border-radius:10px; }
.elysium-model-row:hover { background:#ffffff08; }
.elysium-model-row-active { background:#ffffff0d; border-color:#8884; }
.elysium-model-row [role=status] { flex:none; font-size:12px; color:var(--dsw-alias-label-secondary,#aaa); white-space:nowrap; }
.elysium-model-row [role=status][data-state=connecting] { color:var(--dsw-alias-label-secondary,#aaa); }
.elysium-model-row [role=status][data-state=connected] { color:#6fbf8a; }
.elysium-model-row [role=status][data-state=failed] { color:#cf6666; }
.elysium-panel .elysium-model-row > button[role=radio] { display:flex; align-items:center; gap:10px; flex:1; min-width:0; width:auto; margin:0; min-height:28px; padding:0; border:0; border-radius:0; background:transparent; color:var(--dsw-alias-label-tertiary,#888); font-weight:400; text-align:left; }
.elysium-panel .elysium-model-row-active > button[role=radio] { color:var(--dsw-alias-label-primary,#eee); font-weight:500; }
.elysium-panel .elysium-model-row > button[role=radio]::before { content:''; box-sizing:border-box; flex:none; width:15px; height:15px; border:1.5px solid #6f6f6f; border-radius:50%; background:transparent; }
.elysium-panel .elysium-model-row-active > button[role=radio]::before { border-color:#d8d8d8; background:radial-gradient(circle, #eee 0 4px, transparent 4.5px); }
.elysium-panel .elysium-model-row > button[role=radio]:hover:not(:disabled) { background:transparent; border-color:transparent; color:var(--dsw-alias-label-primary,#eee); }
.elysium-settings .elysium-model-row > button:not([role=radio]) { flex:none; margin:0; min-height:24px; padding:2px 8px; border-radius:6px; font-size:12px; }
.elysium-settings article { border-top:1px solid var(--dsw-alias-border-l1,#8883); padding:10px 0; }
.elysium-settings button { margin:3px 4px 3px 0; }
.elysium-resize-handle { position:absolute; top:0; bottom:0; right:-4px; z-index:2; width:8px; cursor:col-resize; touch-action:none; }
.elysium-resize-handle:hover,.elysium-resize-handle:active { background:var(--dsw-alias-interactive-bg-hover-accent,#8bcaff55); }
body[data-elysium-sidebar-dragging] .elysium-panel { transition:none; will-change:transform; }
#root [data-dsh-frame],#root > [data-slot="root"] > div { box-sizing:border-box; width:calc(100% - var(--elysium-detail-width,0px)); margin-left:0; transition:width var(--ds-transition-duration-slow,200ms) var(--ds-ease-in-out,ease); }
body[data-elysium-sidebar-dragging] #root [data-dsh-frame],body[data-elysium-sidebar-dragging] #root > [data-slot="root"] > div { transition:none; }
.elysium-panel button { min-height:32px; border:1px solid var(--dsw-alias-border-l1,#8883); border-radius:6px; padding:4px 9px; background:transparent; color:var(--dsw-alias-label-primary,#eee); font:inherit; cursor:pointer; transition:background var(--ds-transition-duration-fast,120ms) var(--ds-ease-in-out,ease),border-color var(--ds-transition-duration-fast,120ms) var(--ds-ease-in-out,ease); }
.elysium-panel button:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover,#8882); border-color:var(--dsw-alias-border-l2,#8885); }
.elysium-panel button:disabled { opacity:.45; cursor:default; }
.elysium-panel .elysium-icon-button { flex:none; display:inline-flex; align-items:center; justify-content:center; width:30px; min-width:30px; height:30px; min-height:30px; padding:0; border-color:transparent; border-radius:6px; background:transparent; color:var(--dsw-alias-label-secondary,#aaa); }
.elysium-panel .elysium-icon-button:hover:not(:disabled) { color:var(--dsw-alias-label-primary,#eee); border-color:transparent; }
.elysium-icon-link { display:inline-flex; align-items:center; justify-content:center; width:30px; height:30px; border-radius:6px; color:var(--dsw-alias-label-secondary,#aaa); }
.elysium-icon-link:hover { background:var(--dsw-alias-interactive-bg-hover,#8882); color:var(--dsw-alias-label-primary,#eee); }
.elysium-card-actions { display:flex; align-items:center; gap:2px; margin-top:auto; }
.elysium-project-detail > .elysium-compact-meta { white-space:normal; overflow:visible; }
.elysium-compact-meta { margin:0; color:var(--dsw-alias-label-secondary,#aaa); font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.elysium-visually-hidden { position:absolute !important; width:1px !important; height:1px !important; padding:0 !important; margin:-1px !important; overflow:hidden !important; clip:rect(0,0,0,0) !important; white-space:nowrap !important; border:0 !important; }
.elysium-asset-item { padding:10px 0; border-bottom:1px solid var(--dsw-alias-border-l1,#8883); overflow-wrap:anywhere; }
.elysium-panel a { color:var(--dsw-alias-brand-primary,#8bcaff); }
.elysium-panel input,.elysium-panel textarea,.elysium-panel select { box-sizing:border-box; width:100%; min-height:34px; margin:0; border:1px solid var(--dsw-alias-border-l2,#8885); border-radius:8px; color:var(--dsw-alias-label-primary,#eee); padding:6px 10px; font:inherit; transition:border-color var(--ds-transition-duration-fast,120ms) var(--ds-ease-in-out,ease),background-color var(--ds-transition-duration-fast,120ms) var(--ds-ease-in-out,ease); }
.elysium-panel input,.elysium-panel textarea { appearance:none; background-color:var(--dsw-alias-bg-layer-1,#292929); }
.elysium-panel select { background-color:var(--dsw-alias-bg-layer-3,#303030); }
.elysium-panel input:hover,.elysium-panel textarea:hover,.elysium-panel select:hover { border-color:var(--dsw-alias-border-l3,var(--dsw-alias-label-dimmed,#8888)); }
.elysium-panel input:focus,.elysium-panel textarea:focus,.elysium-panel select:focus { border-color:var(--dsw-alias-border-l4,var(--dsw-alias-brand-primary,#8bcaff)); outline:0; }
.elysium-panel select { appearance:none; cursor:pointer; padding-right:34px; background-image:linear-gradient(45deg,transparent 50%,var(--dsw-alias-label-tertiary,#888) 50%),linear-gradient(135deg,var(--dsw-alias-label-tertiary,#888) 50%,transparent 50%); background-position:calc(100% - 15px) 50%,calc(100% - 10px) 50%; background-size:5px 5px,5px 5px; background-repeat:no-repeat; }
.elysium-panel select:disabled { cursor:default; opacity:.5; }
.elysium-panel select option { background:var(--dsw-alias-bg-layer-2,#202020); color:var(--dsw-alias-label-primary,#eee); }
.elysium-panel input::placeholder,.elysium-panel textarea::placeholder { color:var(--dsw-alias-label-tertiary,#888); opacity:1; }
.elysium-panel-actions { display: flex; gap: 4px; flex-wrap: wrap; }

.elysium-dialog-backdrop { position:fixed; inset:0; z-index:1100; background:#0009; display:grid; place-items:center; padding:16px; }
.elysium-dialog { background:var(--dsw-alias-bg-layer-1,#292929); border:1px solid var(--dsw-alias-border-l2,#8885); border-radius:10px; width:min(960px,100%); max-height:90dvh; display:flex; flex-direction:column; overflow:hidden; }
.elysium-dialog header,.elysium-dialog footer { flex:none; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:16px; }
.elysium-dialog h2 { margin:0; font-size:18px; }
.elysium-dialog-body { overflow:auto; min-height:0; padding:16px; }
.elysium-panel :focus-visible { outline:2px solid var(--dsw-alias-interactive-bg-hover-accent,#8bcaff); outline-offset:2px; }
.elysium-panel [aria-selected=true] { background:var(--dsw-alias-interactive-bg-active,#8883); color:var(--dsw-alias-label-primary,#eee); }
.elysium-material-tabs { display:flex; gap:4px; flex:none; margin-bottom:12px; }
.elysium-theme-grid { display:flex; flex-wrap:wrap; gap:8px; align-content:start; align-items:flex-start; min-height:0; flex:1; overflow:auto; padding-right:2px; scrollbar-width:thin; }
.elysium-panel .elysium-theme-tag { display:inline-flex; align-items:center; gap:2px; margin:0; min-height:32px; padding:4px 6px 4px 12px; border-radius:999px; background:var(--dsw-alias-bg-layer-3,#303030); color:var(--dsw-alias-label-primary,#eee); font-size:13px; font-weight:500; }
.elysium-panel .elysium-theme-tag[aria-checked=true],.elysium-theme-tag-active { background:#6fbf8a22; border-color:#6fbf8a88; color:#cfe9d8; }
.elysium-panel .elysium-theme-tag > .elysium-theme-label { min-height:0; margin:0; padding:0 6px 0 0; border:0; background:transparent; color:inherit; font:inherit; }
.elysium-panel .elysium-theme-tag > .elysium-icon-button { width:24px; min-width:24px; height:24px; min-height:24px; }
.elysium-theme-selection .elysium-theme-grid { flex:none; overflow:visible; }

.elysium-panel-body:has(.elysium-storyboard) { overflow:hidden; display:flex; flex-direction:column; }
.elysium-project-detail,.elysium-project-setup { min-height:0; display:flex; flex-direction:column; flex:1; gap:12px; }
.elysium-project-detail > button { align-self:flex-start; }
.elysium-project-steps { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); flex:none; border-bottom:1px solid var(--dsw-alias-border-l1,#8883); }
.elysium-panel .elysium-project-steps button { position:relative; display:flex; align-items:center; justify-content:center; gap:6px; min-width:0; height:42px; padding:0 4px; border:0; border-radius:0; color:var(--dsw-alias-label-tertiary,#888); }
.elysium-panel .elysium-project-steps button[aria-current=step] { color:var(--dsw-alias-label-primary,#eee); box-shadow:inset 0 -2px var(--dsw-alias-brand-primary,#8bcaff); }
.elysium-panel .elysium-project-steps button[data-complete=true] { color:var(--dsw-alias-label-secondary,#aaa); }
.elysium-project-steps button span { display:grid; place-items:center; width:18px; height:18px; border:1px solid currentColor; border-radius:50%; font-size:10px; }
.elysium-project-steps button b { min-width:0; overflow:hidden; text-overflow:ellipsis; font-size:12px; font-weight:500; }
.elysium-project-stage { min-height:0; display:flex; flex-direction:column; flex:1; gap:8px; overflow:hidden; }
.elysium-project-stage > :not(.elysium-flow-next) { min-height:0; flex:1; }
.elysium-project-form { box-sizing:border-box; width:min(520px,100%); margin:16px auto 0; padding:20px; border:1px solid var(--dsw-alias-border-l2,#8885); border-radius:16px; background:var(--dsw-alias-bg-layer-3,#303030); }
.elysium-project-form footer,.elysium-flow-next { display:flex; justify-content:flex-end; align-items:center; gap:8px; padding-top:12px; border-top:1px solid var(--dsw-alias-border-l1,#8883); }
.elysium-project-form footer .elysium-icon-button { margin-right:auto; }
.elysium-storyboard { min-height:0; flex:1; display:grid; grid-template-columns:176px minmax(0,1fr) 360px; gap:16px; }
.elysium-acts { overflow:auto; display:flex; flex-direction:column; gap:8px; }
.elysium-acts button { text-align:left; }
.elysium-shot-list { min-height:0; display:flex; flex-direction:column; overflow:hidden; }
.elysium-toolbar { display:flex; gap:8px; align-items:flex-end; flex-wrap:wrap; padding:0 0 12px; flex:none; }
.elysium-toolbar input { flex:1 1 180px; width:auto; }
.elysium-toolbar select { flex:0 1 auto; width:auto; max-width:120px; }
.elysium-toolbar [role=status] { margin-right:auto; color:var(--dsw-alias-label-tertiary,#888); font-size:12px; }
.elysium-shot-rows { overflow:auto; min-height:0; flex:1; }
.elysium-panel .elysium-shot-row { display:grid; grid-template-columns:32px 12px 64px minmax(0,1fr); gap:8px; align-items:center; text-align:left; width:100%; height:48px; border:0; border-bottom:1px solid #8883; border-radius:0; }
.elysium-shot-status { width:7px; height:7px; border-radius:50%; background:var(--dsw-alias-label-tertiary,#888); }
.elysium-shot-status[data-status=succeeded] { background:#55a86c; }
.elysium-shot-status[data-status=running],.elysium-shot-status[data-status=queued] { background:#d3a84b; }
.elysium-shot-status[data-status=failed] { background:#cf6666; }
.elysium-shot-summary { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.elysium-panel [aria-pressed=true] { background:var(--dsw-alias-interactive-bg-active,#8883); box-shadow:inset 3px 0 var(--dsw-alias-brand-primary,#8bcaff); }
.elysium-shot-detail { min-height:0; overflow:auto; border-left:1px solid var(--dsw-alias-border-l1,#8883); padding:0 16px; overflow-wrap:anywhere; }
.elysium-shot-detail h2 { font-size:18px; }
.elysium-shot-detail p { white-space:pre-wrap; }
.elysium-shot-heading { display:flex; align-items:center; gap:6px; }
.elysium-shot-heading h2 { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.elysium-shot-copy h3 { margin:12px 0 2px; font-size:12px; color:var(--dsw-alias-label-secondary,#aaa); }
.elysium-shot-copy p { margin:0; }
.elysium-panel .elysium-workbench-preview { display:block; width:100%; max-height:420px; object-fit:contain; background:#111; margin:12px 0; }
.elysium-panel .elysium-anchor-preview .elysium-workbench-preview { width:auto; max-width:min(100%,300px); max-height:240px; margin:12px auto; }
.elysium-pagination { display:flex; justify-content:space-between; gap:8px; align-items:center; padding:12px 0; flex-wrap:wrap; flex:none; }
.elysium-pagination-meta,.elysium-pagination-actions { display:flex; gap:8px; align-items:center; white-space:nowrap; }
.elysium-panel .elysium-pagination-meta select { width:72px; min-width:72px; }
.elysium-empty { text-align:center; padding:40px 16px; color:var(--dsw-alias-label-tertiary,#888); }
.elysium-field { display:block; margin-bottom:14px; }
.elysium-field span { display:block; margin:0 2px 6px; color:var(--dsw-alias-label-secondary,#aaa); font-size:12px; font-weight:500; }
.elysium-field select { width:100%; }
.elysium-panel footer > .elysium-primary { margin-left:auto; order:1; }
.elysium-panel .elysium-primary { background:var(--dsw-alias-interactive-bg-active,#8883); color:var(--dsw-alias-label-primary,#eee); border-color:var(--dsw-alias-border-l2,#8885); }
.elysium-panel .elysium-primary:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover,#8882); border-color:var(--dsw-alias-border-l2,#8885); }
@container elysium-panel (max-width:1279px) { .elysium-storyboard { grid-template-columns:minmax(0,1fr) 320px; } .elysium-acts { display:none; } }
@container elysium-panel (max-width:959px) { .elysium-storyboard { grid-template-columns:minmax(0,1fr); } .elysium-shot-detail { display:none; } .elysium-storyboard.has-selection .elysium-shot-list { display:none; } .elysium-storyboard.has-selection .elysium-shot-detail { display:block; } }
@container elysium-panel (max-width:600px) { .elysium-panel button { min-height:36px; } .elysium-toolbar input { width:100%; } .elysium-shot-row { font-size:12px; } }

.elysium-materials { display:flex; flex-direction:column; min-height:0; height:100%; }
.elysium-materials > .elysium-materials { flex:1; min-height:0; }
.elysium-material-card .elysium-video-placeholder { font-size:14px; font-weight:400; line-height:1.7; padding:12px; text-align:left; white-space:pre-line; overflow:hidden; }
.elysium-materials > .elysium-toolbar select { flex:none; width:86px; }
.elysium-material-grid { display:grid; grid-auto-rows:max-content; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:10px; overflow:auto; align-content:start; min-height:0; flex:1; padding-right:2px; scrollbar-width:thin; }
.elysium-material-card { box-sizing:border-box; border:1px solid var(--dsw-alias-border-l2,#8885); border-radius:12px; padding:10px; min-width:0; display:flex; flex-direction:column; gap:7px; overflow:hidden; background:var(--dsw-alias-bg-layer-3,#303030); transition:background var(--ds-transition-duration-fast,120ms) var(--ds-ease-in-out,ease),border-color var(--ds-transition-duration-fast,120ms) var(--ds-ease-in-out,ease); }
.elysium-material-card:hover { background:var(--dsw-alias-interactive-bg-hover,#8882); border-color:var(--dsw-alias-label-dimmed,var(--dsw-alias-border-l3,#8888)); }
.elysium-material-card > img,.elysium-card-open img,.elysium-card-open video { display:block; width:100%; height:auto; aspect-ratio:3/4; object-fit:contain; background:var(--dsw-alias-bg-layer-2,#202020); border-radius:8px; }
.elysium-panel .elysium-card-open { flex:none; display:block; height:auto; padding:0; border:0; text-align:left; }
.elysium-project-card { position:relative; padding:10px; }
.elysium-project-open { display:flex; flex-direction:column; gap:7px; cursor:pointer; outline:0; }
.elysium-project-open:focus-visible { border-radius:8px; box-shadow:0 0 0 2px var(--dsw-alias-border-l4,var(--dsw-alias-brand-primary,#8bcaff)); }
.elysium-project-open h2 { margin:0; padding-right:30px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.elysium-project-open > img { width:100%; height:112px; object-fit:cover; background:var(--dsw-alias-bg-layer-2,#202020); border-radius:8px; }
.elysium-project-open > .elysium-video-placeholder { height:112px; border-radius:8px; }
.elysium-card-open strong,.elysium-two-lines { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; overflow-wrap:anywhere; }
.elysium-card-open strong { height:42px; margin-top:8px; }
.elysium-video-placeholder { height:180px; background:linear-gradient(145deg,var(--dsw-alias-bg-layer-2,#202020),var(--dsw-alias-interactive-bg-hover,#8882)); border:1px solid var(--dsw-alias-border-l1,#8883); border-radius:8px; display:flex; flex-direction:column; align-items:center; justify-content:center; color:var(--dsw-alias-label-tertiary,#888); font-size:22px; font-weight:600; }
.elysium-material-card > small { color:var(--dsw-alias-label-secondary,#aaa); }
.elysium-dialog-body .elysium-materials { height:min(600px,65dvh); }
.elysium-anchor-view { min-height:0; flex:1; display:flex; flex-direction:column; overflow:hidden; }
.elysium-anchor-view > .elysium-toolbar { justify-content:flex-end; }
.elysium-anchor-create { display:grid; grid-template-columns:minmax(120px,1fr) minmax(160px,2fr) auto; gap:8px; align-items:start; padding:10px; margin-bottom:10px; border:1px solid var(--dsw-alias-border-l2,#8885); border-radius:12px; background:var(--dsw-alias-bg-layer-3,#303030); }
.elysium-anchor-create textarea { min-height:32px; height:32px; resize:vertical; }
.elysium-anchor-create footer { display:flex; gap:3px; }
.elysium-anchor-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:10px; overflow:auto; align-content:start; min-height:0; }
.elysium-anchor-card { display:grid; grid-template-columns:64px minmax(0,1fr) 30px; gap:9px; align-items:start; min-width:0; padding:10px; border:1px solid var(--dsw-alias-border-l2,#8885); border-radius:12px; background:var(--dsw-alias-bg-layer-3,#303030); transition:background var(--ds-transition-duration-fast,120ms) var(--ds-ease-in-out,ease),border-color var(--ds-transition-duration-fast,120ms) var(--ds-ease-in-out,ease); }
.elysium-anchor-card:hover { background:var(--dsw-alias-interactive-bg-hover,#8882); border-color:var(--dsw-alias-label-dimmed,var(--dsw-alias-border-l3,#8888)); }
.elysium-anchor-thumb { display:grid; place-items:center; width:64px; height:64px; overflow:hidden; border-radius:5px; background:#8881; color:var(--dsw-alias-label-tertiary,#888); }
.elysium-anchor-thumb img { width:100%; height:100%; object-fit:cover; }
.elysium-anchor-copy { min-width:0; }
.elysium-anchor-copy h3 { margin:0 0 3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:14px; }
.elysium-anchor-copy p { display:-webkit-box; margin:0; overflow:hidden; -webkit-line-clamp:2; -webkit-box-orient:vertical; color:var(--dsw-alias-label-secondary,#aaa); font-size:12px; overflow-wrap:anywhere; }
.elysium-anchor-card .elysium-card-actions { flex-direction:column; gap:0; margin:0; }
.elysium-project-home { overflow:auto; min-height:0; }
.elysium-project-status-tabs { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); margin:8px 0 12px; border-bottom:1px solid var(--dsw-alias-border-l1,#8883); }
.elysium-panel .elysium-project-status-tabs button { display:flex; align-items:center; justify-content:center; gap:6px; min-width:0; height:38px; padding:0 8px; border:0; border-radius:0; color:var(--dsw-alias-label-tertiary,#888); }
.elysium-panel .elysium-project-status-tabs button[aria-selected=true] { color:var(--dsw-alias-label-primary,#eee); box-shadow:inset 0 -2px var(--dsw-alias-brand-primary,#8bcaff); }
.elysium-project-status-tabs b { min-width:18px; padding:1px 5px; border-radius:9px; background:var(--dsw-alias-bg-layer-3,#303030); font-size:10px; font-weight:500; }
@container elysium-panel (max-width:600px) { .elysium-material-grid { grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:8px; } }
@container elysium-panel (max-width:600px) { .elysium-anchor-create { grid-template-columns:1fr; } .elysium-anchor-create footer { justify-content:flex-end; } }

.elysium-project-heading { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.elysium-project-heading [role=status] { margin-left:auto; color:var(--dsw-alias-label-tertiary,#888); font-size:12px; }
.elysium-panel h1 { font-size:16px; font-weight:600; margin:4px 0; }
.elysium-panel h2 { font-size:15px; font-weight:600; margin:4px 0; }
.elysium-project-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:10px; }
.elysium-project-grid .elysium-card-actions { position:absolute; top:6px; right:6px; }
.elysium-directors { display:flex; flex-direction:column; min-height:0; height:100%; }
.elysium-directors > .elysium-toolbar { justify-content:flex-end; }
.elysium-director-create { display:grid; grid-template-columns:minmax(120px,.7fr) minmax(180px,1fr) minmax(220px,1.4fr) auto; gap:8px; align-items:start; flex:none; margin-bottom:10px; padding:10px; border:1px solid var(--dsw-alias-border-l2,#8885); border-radius:12px; background:var(--dsw-alias-bg-layer-3,#303030); }
.elysium-director-create textarea { min-height:34px; height:34px; resize:vertical; }
.elysium-director-create footer { display:flex; }
.elysium-director-list { min-height:0; overflow:auto; display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:8px; align-content:start; }
.elysium-director-card { display:grid; grid-template-columns:minmax(0,1fr) 30px; gap:8px; padding:10px; border:1px solid var(--dsw-alias-border-l2,#8885); border-radius:12px; background:var(--dsw-alias-bg-layer-3,#303030); }
.elysium-director-card[draggable=true] { cursor:grab; }
.elysium-director-card[data-dragging=true] { opacity:.45; cursor:grabbing; }
.elysium-director-card:hover { background:var(--dsw-alias-interactive-bg-hover,#8882); border-color:var(--dsw-alias-label-dimmed,var(--dsw-alias-border-l3,#8888)); }
.elysium-director-copy { min-width:0; }
.elysium-director-copy h2 { margin:0; }
.elysium-director-copy p { margin:2px 0 7px; color:var(--dsw-alias-label-secondary,#aaa); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.elysium-director-copy ol { display:flex; flex-wrap:wrap; gap:4px 14px; margin:0; padding-left:20px; color:var(--dsw-alias-label-tertiary,#888); font-size:12px; }
.elysium-director-actions { display:flex; flex-direction:column; gap:2px; }
.elysium-delivery { display:grid; grid-template-columns:minmax(0,1fr) 320px; gap:24px; overflow:auto; align-items:start; align-content:start; }
.elysium-delivery > section { min-width:0; overflow-wrap:anywhere; }
.elysium-delivery .elysium-asset-item strong { display:block; white-space:normal; }
.elysium-panel .elysium-delivery-preview .elysium-workbench-preview { max-height:65dvh; }
.elysium-delivery .elysium-card-actions { flex-wrap:wrap; }
.elysium-delivery .elysium-delivery-download { display:inline-flex; align-items:center; gap:6px; margin:0; padding:6px 10px; border:1px solid var(--dsw-alias-border-l2,#8885); border-radius:6px; text-decoration:none; }
.elysium-asset-item a { display:inline-block; margin:8px; }
.elysium-panel details { margin-top:8px; }
.elysium-panel summary { cursor:pointer; min-height:36px; }
.elysium-panel details button { margin:4px; }
.elysium-panel .elysium-icon-menu { margin:0; }
.elysium-panel .elysium-icon-menu > summary { display:flex; align-items:center; justify-content:center; box-sizing:border-box; width:30px; min-width:30px; height:30px; min-height:30px; border-radius:6px; color:var(--dsw-alias-label-secondary,#aaa); list-style:none; }
.elysium-panel .elysium-icon-menu > summary::-webkit-details-marker { display:none; }
.elysium-panel .elysium-icon-menu > summary:hover { background:var(--dsw-alias-interactive-bg-hover,#8882); color:var(--dsw-alias-label-primary,#eee); }
.elysium-asset-item .elysium-icon-link { display:inline-flex; margin:0; }
@container elysium-panel (max-width:959px) { .elysium-delivery { grid-template-columns:minmax(0,1fr); } }
@container elysium-panel (max-width:760px) { .elysium-director-create { grid-template-columns:1fr; } .elysium-director-create textarea { height:84px; } .elysium-director-create footer { justify-content:flex-end; } }
#root [class$="_centerCol"] { margin-left:var(--elysium-list-width,0px); }
.elysium-library-panel { left:var(--elysium-native-nav-width,56px); width:var(--elysium-list-width,250px); }
.elysium-detail-panel { left:auto; right:0; width:var(--elysium-detail-width,400px); border-left:1px solid var(--dsw-alias-border-l2,#8885); border-right:0; }
.elysium-resize-right { left:-4px; right:auto; }
.elysium-library-panel .elysium-project-status-tabs button { flex-direction:column; gap:2px; height:48px; padding:4px 0; font-size:11px; white-space:nowrap; }
.elysium-library-panel .elysium-project-grid { display:flex; flex-direction:column; gap:8px; }
.elysium-library-panel .elysium-project-open > img,.elysium-library-panel .elysium-project-open > .elysium-video-placeholder { display:none; }
.elysium-library-panel .elysium-project-open { padding:12px; }
.elysium-library-panel .elysium-project-open h2 { font-size:14px; }
.elysium-library-panel .elysium-project-card .elysium-compact-meta { white-space:normal; }
.elysium-project-card[data-selected=true] { border-color:#91b3e6; background:#7b9cc522; box-shadow:inset 3px 0 #91b3e6; }
.elysium-series-next { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px; padding-top:12px; }
.elysium-series-next p { margin:0; font-size:12px; color:var(--dsw-alias-label-secondary,#aaa); }
.elysium-overview-configuration { padding:14px; border:1px solid var(--dsw-alias-border-l1,#8883); border-radius:12px; }
@media(max-width:999px) {
  #root [data-dsh-frame],#root > [data-slot="root"] > div { width:100%; top:30dvh; height:35dvh; min-height:0; grid-template-rows:minmax(0,1fr); overflow:visible; }
  #root [class$="_centerCol"] { margin-left:0; grid-column:2; }
  #root [class$="_sidebarCol"] { position:relative; top:-30dvh; height:100dvh; z-index:30; grid-column:1; }
  .elysium-library-panel,.elysium-detail-panel { left:var(--elysium-native-nav-width,56px); right:0; width:auto; bottom:auto; border-bottom:1px solid var(--dsw-alias-border-l2,#8885); }
  .elysium-library-panel { height:30dvh; }
  .elysium-detail-panel { top:65dvh; height:35dvh; }
  .elysium-resize-handle { display:none; }
}
@media(prefers-reduced-motion:reduce) { .elysium-panel,#root [data-dsh-frame],#root > [data-slot="root"] > div { transition:none !important; } }

.elysium-panel { color-scheme:inherit; scrollbar-color:#666 transparent; }
.elysium-panel .elysium-mobile-act { display:none; }
@media(max-width:1279px) { .elysium-panel .elysium-mobile-act { display:inline-flex; } }
`
    document.head.appendChild(style)
    return () => style.remove()
  }
  return exports
} })
