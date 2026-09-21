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

.elysium-toolbar { display:flex; gap:8px; align-items:flex-end; flex-wrap:wrap; padding:0 0 12px; flex:none; }
.elysium-toolbar input { flex:1 1 180px; width:auto; }
.elysium-toolbar select { flex:0 1 auto; width:auto; max-width:120px; }
.elysium-toolbar > .elysium-primary { margin-left:auto; }
.elysium-toolbar [role=status] { margin-right:auto; color:var(--dsw-alias-label-tertiary,#888); font-size:12px; }
.elysium-panel [aria-pressed=true] { background:var(--dsw-alias-interactive-bg-active,#8883); box-shadow:inset 3px 0 var(--dsw-alias-brand-primary,#8bcaff); }
.elysium-panel .elysium-workbench-preview { display:block; width:100%; max-height:420px; object-fit:contain; background:#111; margin:12px 0; }
.elysium-pagination { display:flex; justify-content:space-between; gap:8px; align-items:center; padding:12px 0; flex-wrap:wrap; flex:none; }
.elysium-pagination-meta,.elysium-pagination-actions { display:flex; gap:8px; align-items:center; white-space:nowrap; }
.elysium-panel .elysium-pagination-meta select { width:72px; min-width:72px; }
.elysium-empty { text-align:center; padding:40px 16px; color:var(--dsw-alias-label-tertiary,#888); }
.elysium-field { display:block; margin-bottom:14px; }
.elysium-field span { display:block; margin:0 2px 6px; color:var(--dsw-alias-label-secondary,#aaa); font-size:12px; font-weight:500; }
.elysium-field select { width:100%; }
.elysium-panel .elysium-primary { background:color-mix(in srgb,var(--dsw-alias-brand-primary,#8bcaff) 22%,transparent); color:var(--dsw-alias-brand-primary,#8bcaff); border-color:var(--dsw-alias-brand-primary,#8bcaff); font-weight:600; }
.elysium-panel .elysium-primary:hover:not(:disabled) { background:color-mix(in srgb,var(--dsw-alias-brand-primary,#8bcaff) 32%,transparent); border-color:var(--dsw-alias-brand-primary,#8bcaff); }
@container elysium-panel (max-width:600px) { .elysium-panel-body { padding:8px; } .elysium-panel button { min-height:36px; } .elysium-panel .elysium-icon-button { width:36px; min-width:36px; height:36px; min-height:36px; } .elysium-toolbar input { width:100%; } }

.elysium-materials { display:flex; flex-direction:column; min-height:0; height:100%; }
.elysium-materials > .elysium-toolbar select { flex:none; width:86px; }
.elysium-material-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:10px; overflow:auto; align-content:start; min-height:0; flex:1; padding-right:2px; scrollbar-width:thin; }
.elysium-material-card { box-sizing:border-box; border:1px solid var(--dsw-alias-border-l2,#8885); border-radius:12px; padding:10px; min-width:0; display:flex; flex-direction:column; gap:7px; overflow:hidden; background:var(--dsw-alias-bg-layer-3,#303030); transition:background var(--ds-transition-duration-fast,120ms) var(--ds-ease-in-out,ease),border-color var(--ds-transition-duration-fast,120ms) var(--ds-ease-in-out,ease); }
.elysium-material-card:hover { background:var(--dsw-alias-interactive-bg-hover,#8882); border-color:var(--dsw-alias-label-dimmed,var(--dsw-alias-border-l3,#8888)); }
.elysium-material-card > img,.elysium-card-open img,.elysium-card-open video { width:100%; height:auto; aspect-ratio:3/4; object-fit:contain; background:var(--dsw-alias-bg-layer-2,#202020); border-radius:8px; }
.elysium-panel .elysium-card-open { padding:0; border:0; text-align:left; }
.elysium-card-open strong { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; overflow-wrap:anywhere; }
.elysium-card-open strong { height:42px; margin-top:8px; }
.elysium-video-placeholder { height:180px; background:linear-gradient(145deg,var(--dsw-alias-bg-layer-2,#202020),var(--dsw-alias-interactive-bg-hover,#8882)); border:1px solid var(--dsw-alias-border-l1,#8883); border-radius:8px; display:flex; flex-direction:column; align-items:center; justify-content:center; color:var(--dsw-alias-label-tertiary,#888); font-size:22px; font-weight:600; }
.elysium-material-card > small { color:var(--dsw-alias-label-secondary,#aaa); }
.elysium-dialog-body .elysium-materials { height:min(600px,65dvh); }
@container elysium-panel (max-width:600px) { .elysium-material-grid { grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:8px; } }

.elysium-panel h1 { font-size:16px; font-weight:600; margin:4px 0; }
.elysium-panel h2 { font-size:15px; font-weight:600; margin:4px 0; }
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
@media(max-width:767px) { #root [data-dsh-frame],#root > [data-slot="root"] > div { padding-right:0; } .elysium-panel { width:100% !important; } .elysium-resize-handle { display:none; } }
@media(prefers-reduced-motion:reduce) { .elysium-panel,.elysium-panel-toggle,#root [data-dsh-frame],#root > [data-slot="root"] > div { transition:none !important; } }

.elysium-panel { color-scheme:inherit; scrollbar-color:#666 transparent; }
/* 项目工作台：信息分层——主操作唯一且醒目，状态用徽标，正文可原地编辑，其余操作进“⋯”。 */
.elysium-page-heading { display:flex; align-items:center; gap:8px; flex-wrap:wrap; min-width:0; }
.elysium-page-heading > h2,.elysium-page-heading > h3 { margin:0; }
.elysium-save-state { margin:0 0 0 auto; min-width:44px; text-align:right; font-size:12px; color:var(--dsw-alias-label-tertiary,#888); }
.elysium-badge { display:inline-flex; align-items:center; padding:0 8px; border-radius:10px; font-size:11px; line-height:18px; white-space:nowrap; color:var(--dsw-alias-label-secondary,#aaa); background:color-mix(in srgb,currentColor 12%,transparent); }
.elysium-badge[data-tone=success] { color:var(--dsw-alias-status-success,#55a86c); }
.elysium-badge[data-tone=active] { color:var(--dsw-alias-brand-primary,#4d8ef7); }
.elysium-badge[data-tone=error] { color:var(--dsw-alias-status-error,#cf6666); }
.elysium-banner { display:flex; align-items:center; gap:8px; margin:0; padding:6px 10px; border-radius:8px; font-size:12px; color:var(--dsw-alias-status-error,#cf6666); background:color-mix(in srgb,var(--dsw-alias-status-error,#cf6666) 10%,transparent); }
.elysium-panel .elysium-banner button { min-height:24px; padding:0 8px; margin-left:auto; }
.elysium-error-text { color:var(--dsw-alias-status-error,#cf6666); }
.elysium-warn-text { font-size:11px; color:var(--dsw-alias-status-warning,#d3a84b); }
.elysium-panel .elysium-link { flex:none; white-space:nowrap; min-height:0; padding:0 4px; border:0; background:transparent; color:var(--dsw-alias-brand-primary,#4d8ef7); font-size:12px; }
.elysium-panel .elysium-link:hover:not(:disabled) { background:transparent; text-decoration:underline; }
.elysium-inline { display:block; min-width:0; }
.elysium-inline small { display:block; padding:0 6px; font-size:11px; color:var(--dsw-alias-status-error,#cf6666); }
.elysium-panel .elysium-plain { display:block; min-height:0; padding:3px 6px; border-color:transparent; border-radius:6px; background:transparent; line-height:1.6; resize:none; overflow:hidden; }
.elysium-panel textarea.elysium-plain { field-sizing:content; min-height:calc(1.6em + 8px); }
.elysium-panel .elysium-plain:hover { background:var(--dsw-alias-interactive-bg-hover,#8881); border-color:transparent; }
.elysium-panel .elysium-plain:focus { background:var(--dsw-alias-bg-layer-1,#fff); border-color:var(--dsw-alias-brand-primary,#4d8ef7); }
.elysium-inline-error .elysium-plain { border-color:var(--dsw-alias-status-error,#cf6666); }
.elysium-panel .elysium-mono { font-family:ui-monospace,SFMono-Regular,monospace; font-size:11px; color:var(--dsw-alias-label-secondary,#aaa); }
.elysium-panel .elysium-strong { font-weight:600; }
.elysium-panel .elysium-lead-text { font-size:15px; font-weight:600; }
.elysium-panel .elysium-full-text { min-height:60vh; font:12px/1.7 ui-monospace,SFMono-Regular,monospace; resize:vertical; }

.elysium-page-tabs { display:flex; flex:none; gap:4px; border-bottom:1px solid var(--dsw-alias-border-l1,#8883); }
.elysium-panel .elysium-page-tabs button { min-height:34px; padding:0 16px; border:0; border-radius:0; background:transparent; color:var(--dsw-alias-label-secondary,#aaa); }
.elysium-panel .elysium-page-tabs button[aria-current=page] { color:var(--dsw-alias-label-primary,#222); font-weight:600; box-shadow:inset 0 -2px var(--dsw-alias-brand-primary,#4d8ef7); }
.elysium-segments { display:flex; flex:1; flex-wrap:wrap; gap:2px; }
.elysium-panel .elysium-segments button { min-height:28px; padding:0 10px; border-color:transparent; border-radius:14px; color:var(--dsw-alias-label-secondary,#aaa); }
.elysium-panel .elysium-segments button[aria-current=true] { background:var(--dsw-alias-interactive-bg-active,#8883); color:var(--dsw-alias-label-primary,#222); }
.elysium-segments small { margin-left:4px; opacity:.7; }

.elysium-project-list { display:flex; flex-direction:column; gap:12px; min-height:0; overflow:auto; }
.elysium-project-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:8px; align-content:start; }
.elysium-project-card { display:flex; align-items:flex-start; gap:6px; padding:8px; border:1px solid var(--dsw-alias-border-l2,#8885); border-radius:10px; transition:border-color var(--ds-transition-duration-fast,120ms); }
.elysium-project-card:hover { border-color:var(--dsw-alias-brand-primary,#4d8ef7); }
.elysium-panel .elysium-project-open { flex:1; min-width:0; display:flex; gap:10px; align-items:flex-start; padding:0; border:0; background:transparent; text-align:left; }
.elysium-panel .elysium-project-open:hover:not(:disabled) { background:transparent; }
.elysium-cover { flex:none; width:54px; height:72px; border-radius:6px; object-fit:cover; object-position:top; background:var(--dsw-alias-bg-layer-2,#8882); }
.elysium-cover-empty { display:grid; place-items:center; font-size:20px; font-weight:600; color:var(--dsw-alias-label-tertiary,#888); }
.elysium-project-copy { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
.elysium-project-copy b,.elysium-project-copy small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.elysium-project-copy b { font-size:14px; }
.elysium-project-copy small { font-size:12px; color:var(--dsw-alias-label-secondary,#aaa); }
.elysium-progress { display:block; height:4px; margin:3px 0; overflow:hidden; border-radius:2px; background:#8883; }
.elysium-progress i { display:block; height:100%; background:var(--dsw-alias-status-success,#55a86c); }
.elysium-project-card-side { display:flex; flex-direction:column; align-items:flex-end; gap:4px; }

.elysium-project-detail { min-height:0; flex:1; display:flex; flex-direction:column; gap:8px; }
.elysium-project-detail > :last-child { min-height:0; flex:1; }
.elysium-project-heading { flex:none; display:flex; align-items:center; gap:8px; }
.elysium-heading-copy { flex:1; min-width:0; }
.elysium-panel .elysium-heading-copy h1 { margin:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.elysium-project-page,.elysium-project-form { max-width:760px; overflow:auto; display:flex; flex-direction:column; gap:10px; }
.elysium-project-form .elysium-page-heading h2 { flex:1; }
.elysium-form-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:0 12px; }
.elysium-form-wide { grid-column:1/-1; }
.elysium-panel .elysium-form-grid textarea { resize:vertical; line-height:1.7; }
.elysium-form-footer { display:flex; justify-content:flex-end; gap:8px; }

.elysium-series { min-height:0; overflow:auto; display:flex; flex-direction:column; gap:12px; }
.elysium-series-body { display:flex; flex-direction:column; gap:16px; max-width:1200px; }
.elysium-panel .elysium-block h3 { margin:0 0 6px; font-size:12px; font-weight:600; color:var(--dsw-alias-label-secondary,#aaa); }
.elysium-card-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(340px,1fr)); gap:8px; }
.elysium-card { min-width:0; display:flex; flex-direction:column; gap:2px; padding:8px; border:1px solid var(--dsw-alias-border-l2,#8885); border-radius:10px; }
.elysium-card > header,.elysium-character-copy > header { display:flex; align-items:center; gap:6px; min-height:26px; padding:0 6px; }
.elysium-card > header .elysium-inline { flex:1; min-width:0; }
.elysium-character-card { display:grid; grid-template-columns:96px minmax(0,1fr); gap:10px; }
.elysium-tone { font-size:11px; white-space:nowrap; color:var(--dsw-alias-label-tertiary,#888); }
.elysium-tone[data-tone=success] { color:var(--dsw-alias-status-success,#55a86c); }
.elysium-tone[data-tone=active] { color:var(--dsw-alias-brand-primary,#4d8ef7); }
.elysium-full-editor { display:flex; flex-direction:column; gap:6px; min-height:0; }
.elysium-portrait { display:flex; flex-direction:column; align-items:center; gap:4px; }
.elysium-portrait img,.elysium-portrait-empty { display:block; width:96px; height:128px; border-radius:6px; object-fit:cover; object-position:top; background:var(--dsw-alias-bg-layer-2,#8882); }
.elysium-portrait-empty { display:grid; place-items:center; box-sizing:border-box; border:1px dashed var(--dsw-alias-border-l2,#8885); font-size:12px; color:var(--dsw-alias-label-tertiary,#888); }
.elysium-portrait > div { display:flex; }
.elysium-character-copy { min-width:0; display:flex; flex-direction:column; gap:2px; }
.elysium-inline-label { display:grid; grid-template-columns:30px minmax(0,1fr); align-items:start; }
.elysium-inline-label > span { padding-top:5px; font-size:11px; color:var(--dsw-alias-label-tertiary,#888); }

.elysium-episode { flex:1; min-height:0; display:grid; grid-template-columns:168px minmax(0,1fr); gap:12px; }
.elysium-episode-directory { min-height:0; overflow:auto; display:flex; flex-direction:column; gap:2px; }
.elysium-panel .elysium-episode-directory button { display:flex; flex-direction:column; align-items:flex-start; min-height:0; padding:6px 8px; border:0; border-radius:8px; text-align:left; }
.elysium-episode-directory b { max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; font-weight:500; }
.elysium-panel .elysium-episode-directory button[aria-current=true] { background:var(--dsw-alias-interactive-bg-active,#8883); }
.elysium-episode-main { min-width:0; min-height:0; overflow:auto; display:flex; flex-direction:column; gap:8px; }
.elysium-episode-header { position:sticky; top:0; z-index:3; display:flex; flex-direction:column; gap:4px; padding:2px 0 8px; background:var(--dsw-alias-bg-layer-1,#fff); border-bottom:1px solid var(--dsw-alias-border-l1,#8883); }
.elysium-panel .elysium-brief { display:flex; gap:16px; min-height:0; padding:0; border:0; background:transparent; text-align:left; font-size:12px; color:var(--dsw-alias-label-secondary,#aaa); }
.elysium-panel .elysium-brief:hover:not(:disabled) { background:transparent; color:var(--dsw-alias-label-primary,#222); }
.elysium-brief span { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.elysium-panel .elysium-brief[aria-expanded=true] { flex-direction:column; gap:2px; }
.elysium-brief[aria-expanded=true] span { white-space:normal; }
.elysium-av-head,.elysium-av-row { display:grid; grid-template-columns:minmax(0,1.1fr) minmax(0,1fr); gap:12px; }
.elysium-av-head { padding:0 0 0 14px; font-size:11px; color:var(--dsw-alias-label-tertiary,#888); }
.elysium-scene-head { display:flex; align-items:center; gap:4px; padding:10px 0 4px 14px; border-bottom:1px solid var(--dsw-alias-border-l2,#8885); }
.elysium-scene-head .elysium-inline { flex:none; min-width:0; }
.elysium-panel .elysium-scene-head .elysium-plain { field-sizing:content; min-width:3em; max-width:360px; }
.elysium-panel .elysium-scene-head .elysium-inline:last-child .elysium-plain { font-size:12px; color:var(--dsw-alias-label-tertiary,#888); }
.elysium-scene-number { flex:none; padding:0 6px; border-radius:4px; font-size:11px; line-height:18px; color:var(--dsw-alias-label-secondary,#aaa); background:#8882; }
.elysium-av-row { padding:6px 0; border-bottom:1px solid var(--dsw-alias-border-l1,#8883); }
.elysium-script-column { min-width:0; padding-left:14px; }
.elysium-script-line { position:relative; }
.elysium-script-line[data-kind=action] .elysium-plain { color:var(--dsw-alias-label-secondary,#666); }
.elysium-script-line[data-kind=sound] .elysium-plain { color:var(--dsw-alias-label-tertiary,#888); font-style:italic; }
.elysium-panel .elysium-split { position:absolute; top:-9px; left:-15px; z-index:1; width:18px; height:18px; min-height:0; padding:0; border-radius:50%; font-size:10px; line-height:1; opacity:0; background:var(--dsw-alias-bg-layer-1,#fff); }
.elysium-script-line:hover .elysium-split,.elysium-panel .elysium-split:focus-visible { opacity:1; }
.elysium-shot-card { display:flex; flex-direction:column; gap:4px; padding:6px 8px; border:1px solid var(--dsw-alias-border-l2,#8885); border-radius:8px; }
.elysium-shot-card[data-status=failed] { border-color:var(--dsw-alias-status-error,#cf6666); }
.elysium-shot-card > header { display:flex; align-items:center; gap:4px 6px; flex-wrap:wrap; }
.elysium-shot-card > header .elysium-icon-menu { margin-left:auto; }
.elysium-panel .elysium-shot-card > header button { min-height:24px; padding:0 8px; }
.elysium-shot-body { display:flex; align-items:flex-start; gap:8px; }
.elysium-shot-body > .elysium-thumb { flex:none; }
.elysium-panel .elysium-thumb { position:relative; box-sizing:border-box; width:54px; height:96px; min-height:0; display:grid; place-items:center; overflow:hidden; padding:0; border:0; border-radius:6px; background:var(--dsw-alias-bg-layer-2,#8882); }
.elysium-thumb img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
.elysium-thumb small { position:relative; font-size:10px; color:var(--dsw-alias-label-tertiary,#888); }
.elysium-thumb-play { position:relative; display:grid; place-items:center; width:22px; height:22px; border-radius:50%; font-size:9px; color:#fff; background:#0009; }
.elysium-panel video.elysium-thumb { width:100%; height:auto; max-height:420px; background:#000; }
.elysium-shot-body:has(> video) { flex-direction:column; }
.elysium-shot-text { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
.elysium-shot-fields { display:flex; align-items:center; gap:0; min-width:0; }
.elysium-shot-fields .elysium-inline { flex:none; }
.elysium-panel .elysium-shot-fields .elysium-plain { field-sizing:content; min-width:2em; padding:1px 4px; }
.elysium-panel .elysium-shot-fields .elysium-plain { font-size:12px; color:var(--dsw-alias-label-secondary,#666); }
.elysium-shot-cast { display:flex; align-items:center; margin-left:6px; font-size:11px; color:var(--dsw-alias-label-tertiary,#888); }
.elysium-duration { display:flex; align-items:center; font-size:12px; color:var(--dsw-alias-label-tertiary,#888); }
.elysium-panel .elysium-duration .elysium-plain { text-align:right; }
.elysium-panel .elysium-shot-video { font-size:12px; }
.elysium-panel .elysium-keyframe { margin:0; }
.elysium-panel .elysium-keyframe > summary { min-height:0; padding:2px 6px; font-size:11px; color:var(--dsw-alias-label-tertiary,#888); }
.elysium-pre { margin:4px 0 0; padding:6px 8px; max-height:220px; overflow:auto; white-space:pre-wrap; font-size:11px; border-radius:6px; background:#8881; }
.elysium-unshot { display:flex; align-items:center; gap:8px; padding:6px 10px; border:1px dashed var(--dsw-alias-border-l2,#8885); border-radius:8px; font-size:12px; color:var(--dsw-alias-label-tertiary,#888); }
.elysium-film-panel { display:grid; grid-template-columns:minmax(0,260px) minmax(0,1fr); gap:12px; padding:8px; border:1px solid var(--dsw-alias-border-l2,#8885); border-radius:10px; }
.elysium-film-panel video { width:100%; max-height:460px; border-radius:6px; background:#000; }
.elysium-film-side { min-width:0; display:flex; flex-direction:column; gap:8px; }
.elysium-film-side h3 { flex:1; }
.elysium-film-side a { font-size:12px; }
.elysium-film-shots { display:flex; flex-wrap:wrap; gap:4px; margin:0; padding:0; list-style:none; }
.elysium-panel .elysium-film-shots button { min-height:26px; padding:0 8px; font-size:12px; }
.elysium-panel .elysium-film-shots button[aria-current=true] { border-color:var(--dsw-alias-brand-primary,#4d8ef7); background:var(--dsw-alias-interactive-bg-active,#8883); }
@container elysium-panel (max-width:760px) {
  .elysium-episode { grid-template-columns:minmax(0,1fr); grid-template-rows:auto minmax(0,1fr); gap:6px; }
  .elysium-episode-directory { flex-direction:row; align-items:flex-start; overflow-x:auto; overflow-y:hidden; }
  .elysium-panel .elysium-episode-directory button { flex:none; }
  .elysium-av-head { display:none; }
  .elysium-av-row,.elysium-film-panel { grid-template-columns:minmax(0,1fr); }
  .elysium-av-row { gap:0; margin:6px 0; padding:4px 0 0; border:1px solid var(--dsw-alias-border-l2,#8885); border-radius:10px; }
  .elysium-av-row:has(.elysium-unshot) { border-style:dashed; }
  .elysium-shot-card,.elysium-unshot { border:0; border-top:1px dashed var(--dsw-alias-border-l1,#8883); border-radius:0 0 10px 10px; }
  .elysium-script-column { padding:0 6px 4px 14px; }
  .elysium-card-grid { grid-template-columns:minmax(0,1fr); }
}
`
    document.head.appendChild(style)
    return () => style.remove()
  }
  return exports
} })
