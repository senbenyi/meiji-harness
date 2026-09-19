// 职责：工作台外壳、共享控件与对话框样式，不含列表/详情/素材/设置专属规则。
window.__ModuleLoader__.load({ id: 'elysium/styles-shell', factory: () => ({
  css: `
.elysium-panel-host { position:fixed; inset:0; z-index:25; pointer-events:none; overflow:hidden; overflow:clip; color:var(--dsw-alias-label-primary,#eee); font:13px/1.5 system-ui; }
.elysium-panel { position:absolute; top:0; left:0; bottom:0; z-index:40; display:flex; flex-direction:column; box-sizing:border-box; pointer-events:auto; contain:layout style; container:elysium-panel / inline-size; background:var(--dsw-alias-bg-layer-1,#292929); color:var(--dsw-alias-label-primary,#eee); border-right:1px solid var(--dsw-alias-border-l2,#8885); padding-bottom:env(safe-area-inset-bottom); transition:transform var(--ds-transition-duration-slow,200ms) var(--ds-ease-in-out,ease),width var(--ds-transition-duration-slow,200ms) var(--ds-ease-in-out,ease); }
.elysium-panel-header { display:flex; flex:none; min-width:0; height:34px; box-sizing:border-box; border-bottom:1px solid var(--dsw-alias-border-l1,#8883); background:var(--dsw-alias-bg-layer-1,#292929); }
.elysium-panel-header [role=tablist] { display:flex; flex:1; min-width:0; overflow-x:auto; scrollbar-width:none; }
.elysium-panel-header [role=tablist]::-webkit-scrollbar { display:none; }
.elysium-panel .elysium-panel-header button { flex:none; min-width:64px; height:33px; min-height:33px; padding:0 10px; border:0; border-right:1px solid var(--dsw-alias-border-l1,#8883); border-radius:0; background:transparent; color:var(--dsw-alias-label-secondary,#aaa); font:var(--dsw-font-xxs-12,12px/1.5 system-ui); }
.elysium-panel .elysium-panel-header button:hover { background:var(--dsw-alias-interactive-bg-hover,#8882); color:var(--dsw-alias-label-primary,#eee); }
.elysium-panel .elysium-panel-header button[aria-selected=true] { background:var(--dsw-alias-interactive-bg-active,#8883); color:var(--dsw-alias-label-primary,#eee); }
.elysium-panel .elysium-panel-header .elysium-rail-toggle,.elysium-panel .elysium-app-navbar .elysium-rail-toggle { flex:none; width:34px; min-width:34px; height:33px; min-height:33px; margin-left:auto; padding:0; border:0; border-radius:0; }
.elysium-detail-heading { display:flex; align-items:center; flex:1; min-width:0; padding:0 10px; font-size:12px; color:var(--dsw-alias-label-secondary,#aaa); }
.elysium-panel-body { min-height:0; min-width:0; overflow:hidden; flex:1; padding:16px; display:flex; flex-direction:column; }
.elysium-resize-handle { position:absolute; top:0; bottom:0; right:-4px; z-index:2; width:8px; cursor:col-resize; touch-action:none; }
.elysium-resize-right { left:-4px; right:auto; }
.elysium-resize-handle:hover,.elysium-resize-handle:active { background:var(--dsw-alias-interactive-bg-hover-accent,#8bcaff55); }
body[data-elysium-sidebar-dragging] .elysium-panel { transition:none; will-change:transform; }
#root [data-dsh-frame],#root > [data-slot="root"] > div { box-sizing:border-box; width:100%; margin-left:0; transition:width var(--ds-transition-duration-slow,200ms) var(--ds-ease-in-out,ease); }
body[data-elysium-sidebar-dragging] #root [data-dsh-frame],body[data-elysium-sidebar-dragging] #root > [data-slot="root"] > div { transition:none; }
.elysium-panel button { min-height:32px; border:1px solid var(--dsw-alias-border-l1,#8883); border-radius:6px; padding:4px 9px; background:transparent; color:var(--dsw-alias-label-primary,#eee); font:inherit; cursor:pointer; transition:background var(--ds-transition-duration-fast,120ms) var(--ds-ease-in-out,ease),border-color var(--ds-transition-duration-fast,120ms) var(--ds-ease-in-out,ease); }
.elysium-panel button:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover,#8882); border-color:var(--dsw-alias-border-l2,#8885); }
.elysium-panel button:disabled { opacity:.45; cursor:default; }
.elysium-panel .elysium-icon-button { flex:none; display:inline-flex; align-items:center; justify-content:center; width:30px; min-width:30px; height:30px; min-height:30px; padding:0; border-color:transparent; border-radius:6px; background:transparent; color:var(--dsw-alias-label-secondary,#aaa); }
.elysium-panel .elysium-icon-button:hover:not(:disabled) { color:var(--dsw-alias-label-primary,#eee); border-color:transparent; }
.elysium-icon-link { display:inline-flex; align-items:center; justify-content:center; width:30px; height:30px; border-radius:6px; color:var(--dsw-alias-label-secondary,#aaa); }
.elysium-icon-link:hover { background:var(--dsw-alias-interactive-bg-hover,#8882); color:var(--dsw-alias-label-primary,#eee); }
.elysium-card-actions { display:flex; align-items:center; gap:2px; margin-top:auto; }
.elysium-compact-meta { margin:0; color:var(--dsw-alias-label-secondary,#aaa); font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.elysium-visually-hidden { position:absolute !important; width:1px !important; height:1px !important; padding:0 !important; margin:-1px !important; overflow:hidden !important; clip:rect(0,0,0,0) !important; white-space:nowrap !important; border:0 !important; }
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
.elysium-toolbar { display:flex; gap:8px; align-items:flex-end; flex-wrap:wrap; padding:0 0 12px; flex:none; }
.elysium-toolbar input { flex:1 1 180px; width:auto; }
.elysium-toolbar select { flex:0 1 auto; width:auto; max-width:120px; }
.elysium-toolbar [role=status] { margin-right:auto; color:var(--dsw-alias-label-tertiary,#888); font-size:12px; }
.elysium-empty { text-align:center; padding:40px 16px; color:var(--dsw-alias-label-tertiary,#888); }
.elysium-field { display:block; margin-bottom:14px; }
.elysium-field span { display:block; margin:0 2px 6px; color:var(--dsw-alias-label-secondary,#aaa); font-size:12px; font-weight:500; }
.elysium-field select { width:100%; }
.elysium-panel footer > .elysium-primary { margin-left:auto; order:1; }
.elysium-panel .elysium-primary { background:var(--dsw-alias-interactive-bg-active,#8883); color:var(--dsw-alias-label-primary,#eee); border-color:var(--dsw-alias-border-l2,#8885); }
.elysium-panel .elysium-primary:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover,#8882); border-color:var(--dsw-alias-border-l2,#8885); }
.elysium-panel :focus-visible { outline:2px solid var(--dsw-alias-interactive-bg-hover-accent,#8bcaff); outline-offset:2px; }
.elysium-panel h1 { font-size:16px; font-weight:600; margin:4px 0; }
.elysium-panel h2 { font-size:15px; font-weight:600; margin:4px 0; }
.elysium-panel details { margin-top:8px; }
.elysium-panel summary { cursor:pointer; min-height:36px; }
.elysium-panel details button { margin:4px; }
.elysium-panel .elysium-icon-menu { margin:0; }
.elysium-panel .elysium-icon-menu > summary { display:flex; align-items:center; justify-content:center; box-sizing:border-box; width:30px; min-width:30px; height:30px; min-height:30px; border-radius:6px; color:var(--dsw-alias-label-secondary,#aaa); list-style:none; }
.elysium-panel .elysium-icon-menu > summary::-webkit-details-marker { display:none; }
.elysium-panel .elysium-icon-menu > summary:hover { background:var(--dsw-alias-interactive-bg-hover,#8882); color:var(--dsw-alias-label-primary,#eee); }
.elysium-panel .elysium-workbench-preview { display:block; width:100%; max-height:420px; object-fit:contain; background:#111; margin:12px 0; }
.elysium-dialog-backdrop { position:fixed; inset:0; z-index:1100; background:#0009; display:grid; place-items:center; padding:16px; color:var(--dsw-alias-label-primary,#eee); font:13px/1.5 system-ui; }
.elysium-dialog { background:var(--dsw-alias-bg-layer-1,#292929); border:1px solid var(--dsw-alias-border-l2,#8885); border-radius:10px; width:min(960px,100%); max-height:90dvh; display:flex; flex-direction:column; overflow:hidden; }
.elysium-dialog header,.elysium-dialog footer { flex:none; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:16px; }
.elysium-dialog h2 { margin:0; font-size:18px; }
.elysium-dialog-body { overflow:auto; min-height:0; padding:16px; }
.elysium-dialog button { min-height:32px; border:1px solid var(--dsw-alias-border-l1,#8883); border-radius:6px; padding:4px 9px; background:transparent; color:var(--dsw-alias-label-primary,#eee); font:inherit; cursor:pointer; }
.elysium-dialog input,.elysium-dialog textarea,.elysium-dialog select { box-sizing:border-box; width:100%; min-height:34px; margin:0; border:1px solid var(--dsw-alias-border-l2,#8885); border-radius:8px; color:var(--dsw-alias-label-primary,#eee); padding:6px 10px; font:inherit; background-color:var(--dsw-alias-bg-layer-1,#292929); }
.elysium-dialog select { background-color:var(--dsw-alias-bg-layer-3,#303030); }
.elysium-dialog textarea { min-height:140px; resize:vertical; }
.elysium-dialog .elysium-icon-button { flex:none; display:inline-flex; align-items:center; justify-content:center; width:30px; min-width:30px; height:30px; min-height:30px; padding:0; border-color:transparent; border-radius:6px; background:transparent; color:var(--dsw-alias-label-secondary,#aaa); }
.elysium-dialog .elysium-primary { background:var(--dsw-alias-interactive-bg-active,#8883); color:var(--dsw-alias-label-primary,#eee); border-color:var(--dsw-alias-border-l2,#8885); }
.elysium-dialog fieldset { margin:0; padding:0; border:0; min-width:0; }
.elysium-dialog legend { padding:0; margin:0 0 6px; color:var(--dsw-alias-label-secondary,#aaa); font-size:12px; }
#root [class$="_centerCol"] { margin-left:var(--elysium-list-width,0px); margin-right:var(--elysium-detail-width,0px); }
.elysium-library-panel { left:var(--elysium-native-nav-width,56px); width:var(--elysium-list-width,250px); }
.elysium-detail-panel { left:auto; right:0; width:var(--elysium-detail-width,400px); border-right:0; border-left:1px solid var(--dsw-alias-border-l2,#8885); }
.elysium-library-panel[data-collapsed=true] { overflow:hidden; min-width:0; max-width:var(--elysium-list-width,56px); }
.elysium-library-panel[data-collapsed=true] .elysium-panel-header { justify-content:center; height:48px; border-bottom:0; }
.elysium-library-panel[data-collapsed=true] .elysium-panel-header .elysium-rail-toggle { width:40px; min-width:40px; height:40px; min-height:40px; margin:0; border-radius:8px; }
.elysium-library-panel[data-collapsed=true] .elysium-panel-body { padding:4px; }
.elysium-detail-panel[data-collapsed=true] { overflow:hidden; min-width:0; max-width:var(--elysium-detail-width,56px); }
.elysium-detail-panel[data-collapsed=true] .elysium-panel-header { justify-content:center; height:48px; border-bottom:0; }
.elysium-detail-panel[data-collapsed=true] .elysium-panel-header .elysium-rail-toggle { width:40px; min-width:40px; height:40px; min-height:40px; margin:0; border-radius:8px; }
.elysium-detail-panel[data-collapsed=true] .elysium-panel-body { padding:4px; }
.elysium-panel { color-scheme:inherit; scrollbar-color:#666 transparent; }
@media(max-width:999px) {
  #root [data-dsh-frame],#root > [data-slot="root"] > div { width:100%; top:65dvh; height:35dvh; min-height:0; grid-template-rows:minmax(0,1fr); overflow:visible; }
  #root [class$="_centerCol"] { margin-left:0; grid-column:2; }
  #root [class$="_sidebarCol"] { position:relative; top:-65dvh; height:100dvh; z-index:30; grid-column:1; }
  .elysium-library-panel,.elysium-detail-panel { left:var(--elysium-native-nav-width,56px); right:0; width:auto; bottom:auto; border-bottom:1px solid var(--dsw-alias-border-l2,#8885); }
  .elysium-library-panel { height:30dvh; }
  .elysium-detail-panel { top:30dvh; height:35dvh; left:var(--elysium-native-nav-width,56px); right:0; border-left:0; }
  .elysium-resize-handle { display:none; }
}
@media(prefers-reduced-motion:reduce) { .elysium-panel,#root [data-dsh-frame],#root > [data-slot="root"] > div { transition:none !important; } }
@media(max-width:600px) { .elysium-panel button { min-height:36px; } .elysium-toolbar input { width:100%; } }
`
}) })
