// 职责：素材库、子分类芯片、三视图卡片与导演库样式。
window.__ModuleLoader__.load({ id: 'elysium/styles-materials', factory: () => ({
  css: `
.elysium-materials { display:flex; flex-direction:column; min-height:0; height:100%; }
.elysium-materials > .elysium-materials { flex:1; min-height:0; }
.elysium-material-tabs { display:flex; gap:4px; flex:none; margin-bottom:12px; flex-wrap:wrap; }
.elysium-panel .elysium-material-tabs button[aria-selected=true] { background:var(--dsw-alias-interactive-bg-hover,#8882); color:var(--dsw-alias-label-primary,#eee); }
.elysium-subcategory-tabs { display:flex; flex-wrap:wrap; gap:6px; margin:0 0 10px; flex:none; }
.elysium-panel .elysium-subcategory-tabs button { min-height:28px; height:28px; padding:0 10px; border-radius:999px; font-size:12px; background:transparent; box-shadow:none; }
.elysium-panel .elysium-subcategory-tabs button[aria-pressed=true] { background:var(--dsw-alias-interactive-bg-hover,#8882); box-shadow:none; border-color:var(--dsw-alias-border-l1,#8883); }
.elysium-view-strip { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:6px; }
.elysium-view-strip img,.elysium-view-strip .elysium-video-placeholder { width:100%; height:auto; aspect-ratio:3/4; min-height:0; font-size:12px; }
.elysium-preview-views { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
.elysium-preview-views .elysium-workbench-preview { margin:0; max-height:280px; }
.elysium-theme-grid { display:flex; flex-wrap:wrap; gap:8px; align-content:start; align-items:flex-start; min-height:0; flex:1; overflow:auto; padding-right:2px; scrollbar-width:thin; }
.elysium-panel .elysium-theme-tag { display:inline-flex; align-items:center; gap:2px; margin:0; min-height:32px; padding:4px 6px 4px 12px; border-radius:999px; background:var(--dsw-alias-bg-layer-3,#303030); color:var(--dsw-alias-label-primary,#eee); font-size:13px; font-weight:500; }
.elysium-panel .elysium-theme-tag[aria-checked=true],.elysium-theme-tag-active { background:#6fbf8a22; border-color:#6fbf8a88; color:#cfe9d8; }
.elysium-panel .elysium-theme-tag > .elysium-theme-label { min-height:0; margin:0; padding:0 6px 0 0; border:0; background:transparent; color:inherit; font:inherit; }
.elysium-panel .elysium-theme-tag > .elysium-icon-button { width:24px; min-width:24px; height:24px; min-height:24px; }
.elysium-theme-selection .elysium-theme-grid { flex:none; overflow:visible; }
.elysium-material-card .elysium-video-placeholder { font-size:14px; font-weight:400; line-height:1.7; padding:12px; text-align:left; white-space:pre-line; overflow:hidden; }
.elysium-material-grid { display:grid; grid-auto-rows:max-content; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:10px; overflow:auto; align-content:start; min-height:0; flex:1; padding-right:2px; scrollbar-width:thin; }
.elysium-material-card { box-sizing:border-box; border:1px solid var(--dsw-alias-border-l2,#8885); border-radius:12px; padding:10px; min-width:0; display:flex; flex-direction:column; gap:7px; overflow:hidden; background:var(--dsw-alias-bg-layer-3,#303030); transition:background var(--ds-transition-duration-fast,120ms) var(--ds-ease-in-out,ease),border-color var(--ds-transition-duration-fast,120ms) var(--ds-ease-in-out,ease); }
.elysium-material-card:hover { background:var(--dsw-alias-interactive-bg-hover,#8882); border-color:var(--dsw-alias-label-dimmed,var(--dsw-alias-border-l3,#8888)); }
.elysium-material-card > img,.elysium-card-open img,.elysium-card-open video { display:block; width:100%; height:auto; aspect-ratio:3/4; object-fit:contain; background:var(--dsw-alias-bg-layer-2,#202020); border-radius:8px; }
.elysium-panel .elysium-card-open { flex:none; display:block; height:auto; padding:0; border:0; text-align:left; }
.elysium-card-open strong,.elysium-two-lines { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; overflow-wrap:anywhere; }
.elysium-card-open strong { height:42px; margin-top:8px; }
.elysium-video-placeholder { height:180px; background:linear-gradient(145deg,var(--dsw-alias-bg-layer-2,#202020),var(--dsw-alias-interactive-bg-hover,#8882)); border:1px solid var(--dsw-alias-border-l1,#8883); border-radius:8px; display:flex; flex-direction:column; align-items:center; justify-content:center; color:var(--dsw-alias-label-tertiary,#888); font-size:22px; font-weight:600; }
.elysium-material-card > small { color:var(--dsw-alias-label-secondary,#aaa); }
.elysium-dialog-body .elysium-materials { height:min(600px,65dvh); }
.elysium-pagination { display:flex; justify-content:space-between; gap:8px; align-items:center; padding:12px 0; flex-wrap:wrap; flex:none; }
.elysium-pagination-meta,.elysium-pagination-actions { display:flex; gap:8px; align-items:center; white-space:nowrap; }
.elysium-panel .elysium-pagination-meta select { width:72px; min-width:72px; }
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
@container elysium-panel (max-width:600px) { .elysium-material-grid { grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:8px; } }
@container elysium-panel (max-width:760px) { .elysium-director-create { grid-template-columns:1fr; } .elysium-director-create textarea { height:84px; } .elysium-director-create footer { justify-content:flex-end; } }
`
}) })
