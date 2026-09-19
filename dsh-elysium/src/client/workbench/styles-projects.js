// 职责：项目列表、状态页签、卡片与新建弹窗样式。
window.__ModuleLoader__.load({ id: 'elysium/styles-projects', factory: () => ({
  css: `
.elysium-create-project-dialog { width:min(440px,100%); }
.elysium-dialog .elysium-project-form { width:auto; margin:0; padding:0; border:0; background:transparent; }
.elysium-ratio-options { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.elysium-dialog .elysium-ratio-options button[aria-checked=true] { background:var(--dsw-alias-interactive-bg-hover,#8882); box-shadow:none; }
.elysium-project-form { box-sizing:border-box; width:min(520px,100%); margin:16px auto 0; padding:20px; border:1px solid var(--dsw-alias-border-l2,#8885); border-radius:16px; background:var(--dsw-alias-bg-layer-3,#303030); }
.elysium-project-form footer { display:flex; justify-content:flex-end; align-items:center; gap:8px; padding-top:12px; border-top:1px solid var(--dsw-alias-border-l1,#8883); }
.elysium-project-form footer .elysium-icon-button { margin-right:auto; }
.elysium-project-home { overflow:auto; min-height:0; }
.elysium-project-home > .elysium-toolbar { flex-wrap:nowrap; align-items:center; }
.elysium-project-home > .elysium-toolbar input { flex:1 1 auto; min-width:0; width:auto; }
.elysium-project-status-tabs { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); margin:8px 0 12px; border-bottom:1px solid var(--dsw-alias-border-l1,#8883); }
.elysium-panel .elysium-project-status-tabs button { display:flex; align-items:center; justify-content:center; gap:6px; min-width:0; height:38px; padding:0 8px; border:0; border-radius:0; color:var(--dsw-alias-label-tertiary,#888); background:transparent; box-shadow:none; }
.elysium-panel .elysium-project-status-tabs button[aria-selected=true] { color:var(--dsw-alias-label-primary,#eee); background:transparent; box-shadow:inset 0 -2px var(--dsw-alias-brand-primary,#8bcaff); }
.elysium-project-status-tabs b { min-width:18px; padding:1px 5px; border-radius:9px; background:var(--dsw-alias-bg-layer-3,#303030); font-size:10px; font-weight:500; }
.elysium-project-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:10px; }
.elysium-project-grid .elysium-card-actions { position:absolute; top:6px; right:6px; }
.elysium-project-card { position:relative; box-sizing:border-box; padding:10px; min-width:0; display:flex; flex-direction:column; gap:7px; overflow:hidden; border:1px solid transparent; border-radius:12px; background:transparent; }
.elysium-project-open { display:flex; flex-direction:row; align-items:flex-start; gap:10px; cursor:pointer; outline:0; }
.elysium-project-open:focus-visible { outline:0; box-shadow:none; }
.elysium-project-card .elysium-project-open[aria-pressed=true] { background:transparent; box-shadow:none; }
.elysium-project-cover { flex:0 0 63px; width:63px; height:112px; object-fit:cover; background:var(--dsw-alias-bg-layer-2,#202020); border-radius:8px; }
.elysium-project-body { min-width:0; flex:1 1 auto; display:flex; flex-direction:column; gap:4px; }
.elysium-project-open h2 { display:-webkit-box; margin:0; padding-right:22px; overflow:hidden; overflow-wrap:anywhere; word-break:break-word; white-space:normal; -webkit-box-orient:vertical; -webkit-line-clamp:2; line-height:1.35; }
.elysium-project-episodes { margin:0; color:var(--dsw-alias-label-tertiary,#888); font-size:12px; }
.elysium-project-plot { display:-webkit-box; margin:0; overflow:hidden; overflow-wrap:anywhere; word-break:break-word; -webkit-box-orient:vertical; -webkit-line-clamp:2; line-height:1.45; color:var(--dsw-alias-label-secondary,#bbb); font-size:12px; }
.elysium-project-card[data-selected=true],.elysium-project-card[data-selected=true]:hover { background:#7b9cc522; border-color:transparent; box-shadow:none; }
.elysium-library-panel .elysium-project-status-tabs { margin:0 0 10px; }
.elysium-library-panel .elysium-project-status-tabs button { gap:6px; height:36px; padding:0 6px; font-size:12px; white-space:nowrap; }
.elysium-library-panel .elysium-project-grid { display:flex; flex-direction:column; gap:4px; }
.elysium-library-panel .elysium-project-card { padding:0; border-radius:10px; }
.elysium-library-panel .elysium-project-card:hover { background:var(--dsw-alias-interactive-bg-hover,#8882); }
.elysium-library-panel .elysium-project-open { padding:8px 10px; gap:10px; }
.elysium-library-panel .elysium-project-cover { flex-basis:54px; width:54px; height:96px; border-radius:6px; }
.elysium-library-panel .elysium-project-open h2 { font-size:13px; font-weight:500; }
.elysium-library-panel .elysium-project-card .elysium-project-plot { display:-webkit-box; }
.elysium-library-panel[data-collapsed=true] .elysium-project-home { overflow-x:hidden; }
.elysium-library-panel[data-collapsed=true] .elysium-project-grid { gap:2px; }
.elysium-library-panel[data-collapsed=true] .elysium-project-card { border-radius:8px; }
.elysium-library-panel[data-collapsed=true] .elysium-project-open { flex-direction:column; padding:8px 3px; gap:0; }
.elysium-library-panel[data-collapsed=true] .elysium-project-open h2 { padding:0; font-size:11px; font-weight:500; line-height:1.25; text-align:center; -webkit-line-clamp:3; }
.elysium-library-panel[data-collapsed=true] .elysium-project-cover,.elysium-library-panel[data-collapsed=true] .elysium-project-episodes,.elysium-library-panel[data-collapsed=true] .elysium-project-plot { display:none; }
.elysium-library-panel[data-collapsed=true] .elysium-empty { padding:16px 0; font-size:11px; }
`
}) })
