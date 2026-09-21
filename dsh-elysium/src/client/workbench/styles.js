// 职责：注入项目与素材工作台的布局和交互样式。
window.__ModuleLoader__.load({ id: 'elysium/workbench-styles', factory: require => {
  const exports = {}
  exports.apply = () => {
    const style = document.createElement('style')
    style.textContent = `
.elysium-panel-host { position:fixed; inset:0; z-index:25; pointer-events:none; overflow:hidden; overflow:clip; color:var(--dsw-alias-label-primary,#eee); font:13px/1.5 system-ui; }
.elysium-toggle-cluster { position:absolute; top:calc(3px + env(safe-area-inset-top)); right:10px; z-index:45; display:flex; pointer-events:auto; }
.elysium-panel-toggle { display:flex; align-items:center; justify-content:center; width:28px; height:28px; padding:0; border:0; border-radius:50%; background:transparent; color:var(--dsw-alias-label-secondary,#aaa); cursor:pointer; transition:background var(--ds-transition-duration-slow,200ms) var(--ds-ease-in-out,ease),color var(--ds-transition-duration-slow,200ms) var(--ds-ease-in-out,ease); }
.elysium-panel-toggle:hover { background:var(--dsw-alias-interactive-bg-hover,#8882); color:var(--dsw-alias-label-primary,#eee); }
.elysium-panel { position:absolute; top:0; right:0; bottom:0; z-index:40; display:flex; flex-direction:column; box-sizing:border-box; pointer-events:auto; contain:layout style; container:elysium-panel / inline-size; background:var(--dsw-alias-bg-layer-1,#292929); color:var(--dsw-alias-label-primary,#eee); border-left:1px solid var(--dsw-alias-border-l2,#8885); padding-bottom:env(safe-area-inset-bottom); transition:transform var(--ds-transition-duration-slow,200ms) var(--ds-ease-in-out,ease),width var(--ds-transition-duration-slow,200ms) var(--ds-ease-in-out,ease); }
.elysium-panel-hidden { transform:translateX(102%); pointer-events:none; visibility:hidden; transition:transform var(--ds-transition-duration-slow,200ms) var(--ds-ease-in-out,ease),width var(--ds-transition-duration-slow,200ms) var(--ds-ease-in-out,ease),visibility 0s linear var(--ds-transition-duration-slow,200ms); }
.elysium-panel-header { display:flex; flex:none; min-width:0; height:34px; box-sizing:border-box; padding-right:72px; border-bottom:1px solid var(--dsw-alias-border-l1,#8883); background:var(--dsw-alias-bg-layer-1,#292929); }
.elysium-panel-header .elysium-tabs { flex:1; border-bottom:0; }
.elysium-panel-body { min-height:0; min-width:0; overflow:hidden; flex:1; padding:12px; display:flex; flex-direction:column; }
.elysium-settings { overflow-y:auto; min-height:0; flex:1; overflow-wrap:anywhere; }
.elysium-model-row { display:grid; grid-template-columns:70px minmax(0,140px) auto; justify-content:start; align-items:center; gap:6px; margin:12px 0; }
.elysium-model-row label { white-space:nowrap; font-size:12px; }
.elysium-model-row select { min-width:0; }
.elysium-settings .elysium-model-row button { margin:0; padding:4px 6px; }
.elysium-settings .elysium-model-row { grid-template-columns:70px minmax(0,140px) auto; }
.elysium-settings .elysium-model-row > span { grid-column:2 / -1; font-size:12px; }
.elysium-panel .elysium-model-row button.elysium-connection-ready { color:var(--dsw-alias-status-success,#55a86c); border-color:var(--dsw-alias-status-success,#55a86c); background:color-mix(in srgb,var(--dsw-alias-status-success,#55a86c) 10%,transparent); }
.elysium-panel .elysium-model-row button.elysium-connection-ready:hover:not(:disabled) { background:color-mix(in srgb,var(--dsw-alias-status-success,#55a86c) 18%,transparent); }
.elysium-connection-error { color:var(--dsw-alias-status-error,#cf6666); }
@container elysium-panel (max-width:360px) { .elysium-settings .elysium-model-row { grid-template-columns:70px minmax(0,1fr); } .elysium-settings .elysium-model-row button { grid-column:2; justify-self:start; } .elysium-settings .elysium-model-row > span { grid-column:2; } }
.elysium-settings article { border-top:1px solid var(--dsw-alias-border-l1,#8883); padding:10px 0; }
.elysium-resize-handle { position:absolute; top:0; bottom:0; left:-4px; z-index:2; width:8px; cursor:col-resize; touch-action:none; }
.elysium-resize-handle:hover,.elysium-resize-handle:active { background:var(--dsw-alias-interactive-bg-hover-accent,#8bcaff55); }
body[data-elysium-sidebar-dragging] .elysium-panel { transition:none; will-change:transform; }
#root [data-dsh-frame],#root > [data-slot="root"] > div { box-sizing:border-box; padding-right:var(--elysium-sidebar-width,0px); transition:padding-right var(--ds-transition-duration-slow,200ms) var(--ds-ease-in-out,ease); }
body[data-elysium-sidebar-dragging] #root [data-dsh-frame],body[data-elysium-sidebar-dragging] #root > [data-slot="root"] > div { transition:none; }
.elysium-panel button { min-height:32px; border:1px solid var(--dsw-alias-border-l2,#8885); border-radius:6px; padding:4px 10px; background:transparent; color:var(--dsw-alias-label-primary,#eee); font:inherit; cursor:pointer; transition:background var(--ds-transition-duration-fast,120ms) var(--ds-ease-in-out,ease),border-color var(--ds-transition-duration-fast,120ms) var(--ds-ease-in-out,ease); }
.elysium-panel button:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover,#8882); border-color:var(--dsw-alias-border-l2,#8885); }
.elysium-panel button:disabled { opacity:.45; cursor:default; }
.elysium-panel .elysium-icon-button { flex:none; display:inline-flex; align-items:center; justify-content:center; width:32px; min-width:32px; height:32px; min-height:32px; padding:0; border-color:transparent; border-radius:6px; background:transparent; color:var(--dsw-alias-label-secondary,#aaa); }
.elysium-panel .elysium-icon-button:hover:not(:disabled) { color:var(--dsw-alias-label-primary,#eee); border-color:transparent; }
.elysium-panel .elysium-danger { color:var(--dsw-alias-status-error,#cf6666); }
.elysium-panel .elysium-danger:hover:not(:disabled) { color:var(--dsw-alias-status-error,#cf6666); background:color-mix(in srgb,var(--dsw-alias-status-error,#cf6666) 12%,transparent); border-color:var(--dsw-alias-status-error,#cf6666); }
.elysium-icon-link { display:inline-flex; align-items:center; justify-content:center; width:32px; height:32px; border-radius:6px; color:var(--dsw-alias-label-secondary,#aaa); }
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
.elysium-workbench-dialog { background:var(--dsw-alias-bg-layer-1,#292929); border:1px solid var(--dsw-alias-border-l2,#8885); border-radius:10px; width:min(960px,100%); max-height:90dvh; display:flex; flex-direction:column; overflow:hidden; }
.elysium-workbench-dialog header { flex:none; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:16px; }
.elysium-workbench-dialog footer { flex:none; display:flex; align-items:center; justify-content:flex-end; gap:8px; padding:16px; border-top:1px solid var(--dsw-alias-border-l1,#8883); }
.elysium-workbench-dialog h2 { margin:0; font-size:18px; }
.elysium-dialog-body { overflow:auto; min-height:0; padding:16px; }
.elysium-panel :focus-visible { outline:2px solid var(--dsw-alias-interactive-bg-hover-accent,#8bcaff); outline-offset:2px; }
.elysium-panel [aria-selected=true] { background:var(--dsw-alias-interactive-bg-active,#8883); color:var(--dsw-alias-label-primary,#eee); }
.elysium-tabs { display:flex; min-width:0; flex:none; overflow-x:auto; scrollbar-width:none; border-bottom:1px solid var(--dsw-alias-border-l1,#8883); }
.elysium-tabs::-webkit-scrollbar { display:none; }
.elysium-panel .elysium-tabs button { flex:none; min-width:64px; height:33px; min-height:33px; padding:0 10px; border:0; border-right:1px solid var(--dsw-alias-border-l1,#8883); border-radius:0; background:transparent; color:var(--dsw-alias-label-secondary,#aaa); font:var(--dsw-font-xxs-12,12px/1.5 system-ui); }
.elysium-panel .elysium-tabs button:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover,#8882); color:var(--dsw-alias-label-primary,#eee); }
.elysium-panel .elysium-tabs button[aria-selected=true] { background:var(--dsw-alias-interactive-bg-active,#8883); color:var(--dsw-alias-label-primary,#eee); }
.elysium-material-tabs { margin-bottom:12px; }

.elysium-panel-body:has(.elysium-storyboard) { overflow:hidden; display:flex; flex-direction:column; }
.elysium-project-detail,.elysium-project-setup { min-height:0; display:flex; flex-direction:column; flex:1; gap:12px; }
.elysium-project-detail > button { align-self:flex-start; }
.elysium-project-steps { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); flex:none; border-bottom:1px solid var(--dsw-alias-border-l1,#8883); }
.elysium-panel .elysium-project-steps button { position:relative; display:flex; align-items:center; justify-content:center; gap:6px; min-width:0; height:42px; padding:0 4px; border:0; border-radius:0; color:var(--dsw-alias-label-tertiary,#888); }
.elysium-panel .elysium-project-steps button[aria-current=step] { color:var(--dsw-alias-label-primary,#eee); box-shadow:inset 0 -2px var(--dsw-alias-brand-primary,#8bcaff); }
.elysium-panel .elysium-project-steps button[data-complete=true] { color:var(--dsw-alias-status-success,#55a86c); }
.elysium-panel .elysium-project-steps button[data-progress=true] { color:var(--dsw-alias-status-warning,#d3a84b); }
.elysium-panel .elysium-project-steps button[aria-current=step][data-complete=true],.elysium-panel .elysium-project-steps button[aria-current=step][data-progress=true] { box-shadow:inset 0 -2px currentColor; }
.elysium-panel .elysium-episode-selector button[data-complete=true] { color:var(--dsw-alias-status-success,#55a86c); border-color:currentColor; }
.elysium-panel .elysium-episode-selector button[data-progress=true] { color:var(--dsw-alias-status-warning,#d3a84b); border-color:currentColor; }
.elysium-project-steps button span { display:grid; place-items:center; width:18px; height:18px; border:1px solid currentColor; border-radius:50%; font-size:10px; }
.elysium-project-steps button b { min-width:0; overflow:hidden; text-overflow:ellipsis; font-size:12px; font-weight:500; }
.elysium-project-stage { min-height:0; display:flex; flex-direction:column; flex:1; gap:8px; overflow:hidden; }
.elysium-project-stage > :not(.elysium-flow-next):not(.elysium-production) { min-height:0; flex:1; }
.elysium-script-view,.elysium-episode-planning { min-height:0; overflow:auto; display:flex; flex-direction:column; gap:12px; }
.elysium-planning { min-height:0; padding:12px; border:1px solid var(--dsw-alias-border-l2,#8885); border-radius:12px; }
.elysium-production { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; flex:none; padding:8px 12px; border:1px solid var(--dsw-alias-border-l2,#8885); border-radius:12px; }
.elysium-production p { margin:0; }
.elysium-planning-content { max-height:55vh; overflow:auto; }
.elysium-planning-array,.elysium-planning-item { margin:8px 0; padding:8px; border:1px solid var(--dsw-alias-border-l1,#8883); border-radius:8px; }
.elysium-planning-actions,.elysium-section-heading,.elysium-film-actions { display:flex; align-items:center; justify-content:flex-end; flex-wrap:wrap; gap:8px; }
.elysium-planning-actions { margin-top:12px; padding-top:12px; border-top:1px solid var(--dsw-alias-border-l1,#8883); }
.elysium-section-heading h2 { margin-right:auto; }
.elysium-timeline-list { display:flex; flex-direction:column; gap:8px; }
.elysium-timeline-episodes { display:flex; flex-wrap:wrap; gap:6px; }
.elysium-timeline-episodes button[aria-current=true] { border-color:var(--dsw-alias-brand-primary,#8bcaff); }
.elysium-project-script { gap:6px; }
.elysium-project-script > .elysium-compact-meta { margin:0; }
.elysium-script-view { gap:10px; }
.elysium-script-controls { display:flex; align-items:center; justify-content:flex-end; gap:6px; flex-wrap:wrap; }
.elysium-panel .elysium-script-controls select { width:auto; max-width:145px; }
.elysium-script-controls [role=status] { font-size:12px; color:var(--dsw-alias-label-secondary,#aaa); }
.elysium-script-tabs { flex:none; }
.elysium-panel .elysium-script-summary { box-sizing:border-box; width:100%; min-height:480px; padding:16px; border:1px solid var(--dsw-alias-border-l1,#8883); border-radius:10px; background:var(--dsw-alias-bg-layer-1,#292929); color:var(--dsw-alias-label-primary,#eee); font:13px/1.7 ui-monospace,SFMono-Regular,monospace; resize:vertical; }
.elysium-script-episode h3 { margin:0 0 8px; }
.elysium-script-episodes { display:grid; grid-template-columns:220px minmax(0,1fr); align-items:start; gap:16px; }
.elysium-script-directory { display:flex; flex-direction:column; gap:4px; }
.elysium-panel .elysium-script-directory button { display:grid; grid-template-columns:28px minmax(0,1fr) auto; align-items:center; gap:8px; min-width:0; width:100%; text-align:left; }
.elysium-script-directory button[aria-current=true] { border-color:var(--dsw-alias-brand-primary,#8bcaff); }
.elysium-script-directory span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.elysium-script-directory small { color:var(--dsw-alias-label-tertiary,#888); }
.elysium-script-episode { min-width:0; }
.elysium-script-episode > p { margin:0 0 8px; line-height:1.6; }
.elysium-panel .elysium-script-body { box-sizing:border-box; width:100%; min-height:360px; margin:12px 0 0; padding:16px; border:1px solid var(--dsw-alias-border-l1,#8883); border-radius:10px; background:var(--dsw-alias-bg-layer-1,#292929); color:var(--dsw-alias-label-primary,#eee); font:13px/1.8 ui-monospace,SFMono-Regular,monospace; white-space:pre-wrap; overflow-wrap:anywhere; }
.elysium-panel .elysium-script-body { resize:vertical; }
.elysium-script-back { display:none; }
@container elysium-panel (max-width:600px) { .elysium-script-episodes { display:block; } .elysium-script-episodes[data-mobile-selected=true] .elysium-script-directory,.elysium-script-episodes[data-mobile-selected=false] .elysium-script-episode { display:none; } .elysium-script-back { display:inline-block; margin-bottom:10px; } }
.elysium-project-form { box-sizing:border-box; width:100%; margin:0; overflow:auto; }
.elysium-project-setup > .elysium-project-form { min-height:0; flex:1; }
.elysium-project-form-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px; }
.elysium-project-form-heading h2 { margin:0; }
.elysium-project-form .elysium-field { margin-bottom:8px; }
.elysium-project-form .elysium-field span { margin-bottom:3px; }
.elysium-panel .elysium-project-form textarea { min-height:400px; resize:vertical; font-family:ui-monospace,SFMono-Regular,monospace; }
.elysium-project-form footer,.elysium-flow-next { display:flex; justify-content:flex-end; align-items:center; gap:8px; padding-top:8px; border-top:1px solid var(--dsw-alias-border-l1,#8883); }
.elysium-storyboard { min-height:0; flex:1; display:grid; grid-template-columns:176px minmax(0,1fr) 360px; gap:16px; }
.elysium-acts { overflow:auto; display:flex; flex-direction:column; gap:8px; }
.elysium-acts button { text-align:left; }
.elysium-shot-list { min-height:0; display:flex; flex-direction:column; overflow:hidden; }
.elysium-toolbar { display:flex; gap:8px; align-items:flex-end; flex-wrap:wrap; padding:0 0 12px; flex:none; }
.elysium-toolbar input { flex:1 1 180px; width:auto; }
.elysium-toolbar select { flex:0 1 auto; width:auto; max-width:120px; }
.elysium-toolbar > .elysium-primary { margin-left:auto; }
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
.elysium-shot-detail .elysium-card-actions { flex-wrap:wrap; gap:8px; margin:16px 0; }
.elysium-shot-detail .elysium-card-actions > .elysium-icon-menu { margin-left:auto; }
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
.elysium-panel .elysium-primary { background:color-mix(in srgb,var(--dsw-alias-brand-primary,#8bcaff) 22%,transparent); color:var(--dsw-alias-brand-primary,#8bcaff); border-color:var(--dsw-alias-brand-primary,#8bcaff); font-weight:600; }
.elysium-panel .elysium-primary:hover:not(:disabled) { background:color-mix(in srgb,var(--dsw-alias-brand-primary,#8bcaff) 32%,transparent); border-color:var(--dsw-alias-brand-primary,#8bcaff); }
@container elysium-panel (max-width:1279px) { .elysium-storyboard { grid-template-columns:minmax(0,1fr) 320px; } .elysium-acts { display:none; } }
@container elysium-panel (max-width:959px) { .elysium-storyboard { grid-template-columns:minmax(0,1fr); } .elysium-shot-detail { display:none; } .elysium-storyboard.has-selection .elysium-shot-list { display:none; } .elysium-storyboard.has-selection .elysium-shot-detail { display:block; } }
@container elysium-panel (max-width:600px) { .elysium-panel-body { padding:8px; } .elysium-panel button { min-height:36px; } .elysium-panel .elysium-icon-button { width:36px; min-width:36px; height:36px; min-height:36px; } .elysium-toolbar input { width:100%; } .elysium-shot-row { font-size:12px; } }

.elysium-materials { display:flex; flex-direction:column; min-height:0; height:100%; }
.elysium-materials > .elysium-toolbar select { flex:none; width:86px; }
.elysium-material-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:10px; overflow:auto; align-content:start; min-height:0; flex:1; padding-right:2px; scrollbar-width:thin; }
.elysium-material-card { box-sizing:border-box; border:1px solid var(--dsw-alias-border-l2,#8885); border-radius:12px; padding:10px; min-width:0; display:flex; flex-direction:column; gap:7px; overflow:hidden; background:var(--dsw-alias-bg-layer-3,#303030); transition:background var(--ds-transition-duration-fast,120ms) var(--ds-ease-in-out,ease),border-color var(--ds-transition-duration-fast,120ms) var(--ds-ease-in-out,ease); }
.elysium-material-card:hover { background:var(--dsw-alias-interactive-bg-hover,#8882); border-color:var(--dsw-alias-label-dimmed,var(--dsw-alias-border-l3,#8888)); }
.elysium-material-card > img,.elysium-card-open img,.elysium-card-open video { width:100%; height:auto; aspect-ratio:3/4; object-fit:contain; background:var(--dsw-alias-bg-layer-2,#202020); border-radius:8px; }
.elysium-panel .elysium-card-open { padding:0; border:0; text-align:left; }
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
.elysium-anchor-create footer { display:flex; justify-content:flex-end; gap:8px; }
.elysium-anchor-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:10px; overflow:auto; align-content:start; min-height:0; }
.elysium-anchor-group { display:grid; grid-column:1/-1; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:10px; }
.elysium-anchor-group h2 { grid-column:1/-1; margin:4px 0; font-size:14px; }
.elysium-anchor-card { display:grid; grid-template-columns:64px minmax(0,1fr) 30px; gap:9px; align-items:start; min-width:0; padding:10px; border:1px solid var(--dsw-alias-border-l2,#8885); border-radius:12px; background:var(--dsw-alias-bg-layer-3,#303030); transition:background var(--ds-transition-duration-fast,120ms) var(--ds-ease-in-out,ease),border-color var(--ds-transition-duration-fast,120ms) var(--ds-ease-in-out,ease); }
.elysium-anchor-card:hover { background:var(--dsw-alias-interactive-bg-hover,#8882); border-color:var(--dsw-alias-label-dimmed,var(--dsw-alias-border-l3,#8888)); }
.elysium-anchor-thumb { display:grid; place-items:center; width:64px; height:64px; overflow:hidden; border-radius:5px; background:#8881; color:var(--dsw-alias-label-tertiary,#888); }
.elysium-anchor-thumb img { width:100%; height:100%; object-fit:cover; }
.elysium-anchor-copy { min-width:0; }
.elysium-anchor-copy h3 { margin:0 0 3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:14px; }
.elysium-anchor-copy small { display:block; color:var(--dsw-alias-label-secondary,#aaa); }
.elysium-anchor-copy p { display:-webkit-box; margin:0; overflow:hidden; -webkit-line-clamp:2; -webkit-box-orient:vertical; color:var(--dsw-alias-label-secondary,#aaa); font-size:12px; overflow-wrap:anywhere; }
.elysium-anchor-card .elysium-card-actions { flex-direction:column; gap:0; margin:0; }
.elysium-project-home { overflow:auto; min-height:0; }
.elysium-project-status-tabs { margin:8px 0 12px; }
.elysium-panel .elysium-project-status-tabs button { display:flex; flex:1; align-items:center; justify-content:center; gap:6px; min-width:0; }
.elysium-project-status-tabs b { min-width:18px; padding:1px 5px; border-radius:9px; background:var(--dsw-alias-bg-layer-3,#303030); font-size:10px; font-weight:500; }
@container elysium-panel (max-width:600px) { .elysium-material-grid { grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:8px; } }
@container elysium-panel (max-width:600px) { .elysium-anchor-create { grid-template-columns:1fr; } .elysium-anchor-create footer { justify-content:flex-end; } }

.elysium-project-heading { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.elysium-project-heading [role=status] { margin-left:auto; color:var(--dsw-alias-label-tertiary,#888); font-size:12px; }
.elysium-panel h1 { font-size:16px; font-weight:600; margin:4px 0; }
.elysium-panel h2 { font-size:15px; font-weight:600; margin:4px 0; }
.elysium-project-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:10px; }
.elysium-project-grid .elysium-card-actions { position:absolute; top:6px; right:6px; }
.elysium-directors { display:flex; flex-direction:column; min-height:0; height:100%; overflow:auto; scrollbar-width:thin; }
.elysium-director-heading { display:flex; justify-content:flex-end; flex:none; padding-bottom:8px; }
.elysium-director-tabs { margin-bottom:8px; }
.elysium-director-picker { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
.elysium-panel .elysium-director-picker select { width:min(100%,180px); min-height:30px; height:30px; padding:3px 28px 3px 8px; }
.elysium-director-create { display:flex; align-items:center; gap:8px; flex:none; margin-bottom:8px; padding:8px; border:1px solid var(--dsw-alias-border-l1,#8883); border-radius:8px; }
.elysium-director-create input { flex:1; min-width:0; }
.elysium-director-create:has(textarea) { flex-direction:column; align-items:stretch; }
.elysium-panel .elysium-director-create h2 { margin:0; }
.elysium-director-create header { display:flex; align-items:center; justify-content:space-between; }
.elysium-director-editor { display:flex; flex-direction:column; gap:6px; }
.elysium-director-create textarea { min-height:160px; resize:vertical; }
.elysium-director-create footer { display:flex; justify-content:flex-end; gap:6px; }
.elysium-director-list { flex:none; display:flex; flex-direction:column; }
.elysium-director-toolbar { display:flex; justify-content:flex-end; }
.elysium-director-card { min-width:0; border-bottom:1px solid var(--dsw-alias-border-l1,#8883); }
.elysium-director-card[data-dragging=true] { opacity:.45; }
.elysium-director-card-heading { display:flex; align-items:center; gap:8px; min-width:0; min-height:42px; }
.elysium-director-grip { color:var(--dsw-alias-label-tertiary,#888); cursor:grab; font-size:15px; letter-spacing:-5px; padding-right:5px; user-select:none; }
.elysium-panel .elysium-director-card-heading h2 { min-width:0; margin:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; font-weight:600; }
.elysium-director-actions { display:flex; align-items:center; gap:2px; margin-left:auto; }
.elysium-director-works { padding-top:14px; border-top:1px solid var(--dsw-alias-border-l1,#8883); }
.elysium-director-works ul { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px 16px; margin:0; padding:0; list-style:none; color:var(--dsw-alias-label-primary,#eee); font-size:12px; line-height:1.55; }
.elysium-director-works li { min-width:0; overflow-wrap:anywhere; }
.elysium-delivery { display:grid; grid-template-columns:minmax(0,1fr) 320px; gap:24px; overflow:auto; align-items:start; align-content:start; }
.elysium-delivery > section { min-width:0; overflow-wrap:anywhere; }
.elysium-delivery .elysium-asset-item strong { display:block; white-space:normal; }
.elysium-panel .elysium-delivery-preview .elysium-workbench-preview { max-height:65dvh; }
.elysium-delivery .elysium-card-actions { flex-wrap:wrap; }
.elysium-delivery .elysium-delivery-download { display:inline-flex; align-items:center; gap:6px; min-height:32px; margin:0; padding:4px 10px; border:1px solid var(--dsw-alias-border-l2,#8885); border-radius:6px; color:var(--dsw-alias-label-primary,#eee); text-decoration:none; }
.elysium-delivery .elysium-delivery-download:hover { background:var(--dsw-alias-interactive-bg-hover,#8882); }
.elysium-asset-item a { display:inline-block; margin:8px; }
.elysium-panel details { margin-top:8px; }
.elysium-panel summary { cursor:pointer; min-height:36px; }
.elysium-panel .elysium-icon-menu { position:relative; margin:0; }
.elysium-panel .elysium-menu-items { position:absolute; top:100%; right:0; z-index:5; display:flex; flex-direction:column; gap:2px; box-sizing:border-box; min-width:170px; padding:4px; border:1px solid var(--dsw-alias-border-l2,#8885); border-radius:8px; background:var(--dsw-alias-bg-layer-2,#202020); box-shadow:0 8px 24px #0005; }
.elysium-panel .elysium-menu-items button { width:100%; text-align:left; border-color:transparent; }
.elysium-panel .elysium-pagination .elysium-menu-items { top:auto; bottom:100%; }
.elysium-panel .elysium-icon-menu > summary { display:flex; align-items:center; justify-content:center; box-sizing:border-box; width:32px; min-width:32px; height:32px; min-height:32px; border-radius:6px; color:var(--dsw-alias-label-secondary,#aaa); list-style:none; }
.elysium-panel .elysium-icon-menu > summary::-webkit-details-marker { display:none; }
.elysium-panel .elysium-icon-menu > summary:hover { background:var(--dsw-alias-interactive-bg-hover,#8882); color:var(--dsw-alias-label-primary,#eee); }
.elysium-asset-item .elysium-icon-link { display:inline-flex; margin:0; }
@container elysium-panel (max-width:959px) { .elysium-delivery { grid-template-columns:minmax(0,1fr); } }
@media(max-width:767px) { #root [data-dsh-frame],#root > [data-slot="root"] > div { padding-right:0; } .elysium-panel { width:100% !important; } .elysium-resize-handle { display:none; } }
@media(prefers-reduced-motion:reduce) { .elysium-panel,.elysium-panel-toggle,#root [data-dsh-frame],#root > [data-slot="root"] > div { transition:none !important; } }

.elysium-panel { color-scheme:inherit; scrollbar-color:#666 transparent; }
.elysium-panel .elysium-mobile-act { display:none; }
@media(max-width:1279px) { .elysium-panel .elysium-mobile-act { display:inline-flex; } }
.elysium-series,.elysium-project-page,.elysium-episode-main { min-width:0; overflow:auto; }
.elysium-series article,.elysium-scene,.elysium-project-page { padding:10px; border:1px solid var(--dsw-alias-border-l2,#8885); border-radius:8px; margin:8px 0; }
.elysium-character-card { display:grid; grid-template-columns:minmax(0,1fr) minmax(120px,180px); gap:8px; }
.elysium-character-card > h4,.elysium-character-card > .elysium-card-actions { grid-column:1/-1; }
.elysium-episode { display:grid; grid-template-columns:minmax(130px,190px) minmax(0,1fr); gap:10px; min-height:0; flex:1; }
.elysium-episode-directory { display:flex; flex-direction:column; gap:4px; overflow:auto; border-right:1px solid var(--dsw-alias-border-l2,#8885); padding-right:8px; }
.elysium-episode-directory button { text-align:left; }
.elysium-episode-directory button[aria-current=true] { border-color:var(--dsw-alias-interactive-bg-hover-accent,#8bcaff); }
.elysium-episode-header { position:sticky; top:0; z-index:2; padding:8px; background:var(--dsw-alias-bg-layer-1,#292929); border-bottom:1px solid var(--dsw-alias-border-l2,#8885); }
.elysium-av-row { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:12px; border-top:1px solid var(--dsw-alias-border-l1,#8883); padding:8px 0; }
.elysium-script-column { display:flex; flex-direction:column; gap:6px; }
.elysium-script-line { display:flex; flex-direction:column; }
.elysium-split { opacity:.55; align-self:start; font-size:11px; }
.elysium-script-line:hover .elysium-split { opacity:1; }
.elysium-shot-card { border:1px solid var(--dsw-alias-border-l2,#8885); border-radius:8px; padding:8px; min-width:0; }
.elysium-shot-card .elysium-workbench-preview { max-width:100%; }
.elysium-shot-fields { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:5px; }
.elysium-inline input,.elysium-inline textarea,.elysium-full-script { width:100%; box-sizing:border-box; min-width:0; }
.elysium-inline-error { color:var(--dsw-alias-status-error,#cf6666); }
.elysium-unshot { padding:10px; color:var(--dsw-alias-label-secondary,#aaa); background:#8882; }
.elysium-film-drawer { position:absolute; top:0; right:0; bottom:0; z-index:5; width:min(420px,100%); overflow:auto; padding:16px; background:var(--dsw-alias-bg-layer-1,#292929); box-shadow:-8px 0 25px #0008; }
.elysium-film-drawer video { width:100%; }
.elysium-film-drawer li[data-current] { background:#8884; }
@container elysium-panel (max-width:680px) { .elysium-episode { display:block; } .elysium-episode-directory { flex-direction:row; border-right:0; border-bottom:1px solid var(--dsw-alias-border-l2,#8885); } .elysium-av-row { grid-template-columns:minmax(0,1fr); } .elysium-shot-card { margin-left:8px; } }

`
    document.head.appendChild(style)
    return () => style.remove()
  }
  return exports
} })
