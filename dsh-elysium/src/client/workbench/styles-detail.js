// 职责：右侧项目详情与 Scene/Segment 工作流样式。
window.__ModuleLoader__.load({ id: 'elysium/styles-detail', factory: () => ({
  css: `
.elysium-production-form { display:flex; flex-direction:column; gap:18px; padding:4px 2px 20px; }
.elysium-production-form .elysium-field { display:flex; flex-direction:column; gap:8px; }
.elysium-production-step { padding:18px; }
.elysium-production-step > p,.elysium-original-request { white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.8; }
.elysium-production-form input,.elysium-production-form textarea,.elysium-production-form select { width:100%; box-sizing:border-box; }
.elysium-series-workflow video { width:100%; border-radius:10px; }
.elysium-project-workflow { display:flex; flex-direction:column; gap:12px; flex:1; min-height:0; min-width:0; overflow-y:auto; overflow-x:hidden; overscroll-behavior:contain; scrollbar-gutter:stable; scrollbar-width:thin; padding:0 6px 20px 0; }
.elysium-workflow-step { flex:none; min-width:0; border:1px solid var(--dsw-alias-border-l1,#8883); border-radius:12px; padding:14px; background:var(--dsw-alias-bg-layer-2,#222); }
.elysium-panel .elysium-step-heading { display:block; width:100%; text-align:left; font-weight:600; border:0; padding:4px 0; margin:0; background:transparent; }
.elysium-panel .elysium-step-heading[aria-expanded=true] { margin-bottom:16px; padding-bottom:12px; border-bottom:1px solid var(--dsw-alias-border-l1,#8883); border-radius:0; }
.elysium-project-workflow textarea, .elysium-project-workflow select { width:100%; box-sizing:border-box; background:var(--dsw-alias-bg-layer-1,#292929); }
.elysium-project-workflow .elysium-primary { width:100%; margin-top:12px; min-height:40px; font-weight:600; }
.elysium-production-step .elysium-series-next { display:flex; justify-content:flex-end; }
.elysium-project-workflow .elysium-production-step .elysium-primary { width:auto; margin-top:0; }
.elysium-story-model { color:var(--dsw-alias-label-secondary,#aaa); font-size:12px; }
@container elysium-panel (max-width:440px) { .elysium-workflow-step { padding:12px; } }
.elysium-project-detail { min-height:0; display:flex; flex-direction:column; flex:1; gap:12px; }
.elysium-project-detail > .elysium-compact-meta { white-space:normal; overflow:visible; }
.elysium-project-workflow.elysium-step-detail { overflow:hidden; padding:0; gap:0; scrollbar-gutter:auto; }
.elysium-detail-panel .elysium-project-workflow.elysium-step-detail { margin:0 -18px; }
.elysium-detail-panel .elysium-app-navbar { padding:0 8px 0 18px; }
.elysium-step-detail-body { flex:1; min-height:0; min-width:0; overflow-y:auto; overflow-x:hidden; scrollbar-width:thin; scrollbar-gutter:stable; overscroll-behavior:contain; padding:18px 6px 20px 0; }
.elysium-step-detail-footer { flex:none; display:flex; justify-content:flex-end; gap:10px; padding:12px 0 0; border-top:1px solid var(--dsw-alias-border-l1,#8883); background:var(--dsw-alias-bg-layer-1,#292929); }
.elysium-step-detail-footer > button { min-height:40px; }
.elysium-project-workflow .elysium-step-detail-footer .elysium-primary { width:auto; flex:1; margin:0; }
.elysium-step-detail-body .elysium-field { display:flex; flex-direction:column; gap:8px; margin-bottom:14px; }
.elysium-workflow-notices:empty { display:none; }
@container elysium-panel (max-width:440px) { .elysium-step-detail-footer { flex-wrap:wrap; } }
.elysium-series-workflow { container:elysium-series / inline-size; }
.elysium-app-navbar { display:flex; align-items:center; flex:none; gap:10px; min-height:34px; padding:0; border-bottom:1px solid var(--dsw-alias-border-l1,#8883); }
.elysium-app-navbar h1 { flex:1; min-width:0; margin:0; font-size:13px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:left; }
.elysium-panel .elysium-app-navbar > button { display:flex; align-items:center; gap:6px; padding:4px 0; border:0; color:var(--dsw-alias-label-secondary,#aaa); background:transparent; font-size:12px; }
.elysium-app-navbar > button span { font-size:25px; line-height:1; }
.elysium-series-workflow .elysium-step-detail-body { padding:16px 0 24px; }
.elysium-series-overview { display:flex; flex-direction:column; gap:24px; min-width:0; }
.elysium-series-intro > span { font-size:10px; letter-spacing:2px; color:var(--dsw-alias-label-tertiary,#888); }
.elysium-series-intro h2 { font-size:22px; margin:6px 0; line-height:1.4; }
.elysium-series-intro p { margin:6px 0 0; font-size:12px; color:var(--dsw-alias-label-secondary,#aaa); }
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
.elysium-episode-placeholder { display:flex; align-items:center; justify-content:center; height:82px; border-radius:7px; background:linear-gradient(135deg,#7192b21a,#7192b206); font-size:32px; font-weight:300; color:#9ab1cf; }
.elysium-episode-excerpt { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; min-height:38px; line-height:1.6; font-size:12px; color:var(--dsw-alias-label-secondary,#aaa); }
.elysium-step-status { flex:none; padding:3px 8px; border-radius:20px; background:#8882; color:var(--dsw-alias-label-secondary,#aaa); font-size:11px; font-weight:400; }
.elysium-step-status[data-status=生成中] { background:#8daedd22; color:#adc4ed; }
.elysium-step-status[data-status=已完成] { background:#81bc9d22; color:#97c7ab; }
.elysium-step-status[data-status=生成失败],.elysium-step-status[data-status=待更新] { background:#d3a07022; color:#dfb28a; }
.elysium-edit-section { padding:18px; border:1px solid var(--dsw-alias-border-l1,#8883); border-radius:12px; background:var(--dsw-alias-bg-layer-2,#222); }
.elysium-tail-toggle { display:flex; align-items:center; gap:10px; cursor:pointer; }
.elysium-tail-toggle input[type=checkbox] { appearance:auto; flex:0 0 18px; width:18px; height:18px; min-height:18px; padding:0; accent-color:var(--dsw-alias-brand-primary,#8bcaff); }
.elysium-edit-section h2,.elysium-edit-section h3 { font-size:14px; margin:0 0 18px; }
.elysium-series-workflow .elysium-field { font-size:12px; color:var(--dsw-alias-label-secondary,#aaa); }
.elysium-series-workflow textarea { resize:vertical; line-height:1.8; }
.elysium-shot-form-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:0 14px; }
.elysium-shot-form-grid > * { min-width:0; }
.elysium-shot-reference { display:block; width:100%; height:160px; object-fit:contain; border-radius:8px; background:#151515; }
.elysium-series-empty { padding:48px 16px; text-align:center; border:0; border-radius:0; background:transparent; color:var(--dsw-alias-label-secondary,#aaa); }
.elysium-series-empty strong { display:block; margin-bottom:8px; color:var(--dsw-alias-label-primary,#eee); font-size:15px; }
.elysium-series-empty p { margin:0; font-size:12px; line-height:1.7; }
.elysium-generating-notice { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px; margin-bottom:14px; background:#86a4cf11; border-radius:8px; font-size:12px; }
.elysium-series-workflow .elysium-step-detail-footer { gap:8px; }
.elysium-series-workflow .elysium-step-detail-footer button { font-size:12px; }
.elysium-series-next { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px; padding-top:12px; }
.elysium-series-next p { margin:0; font-size:12px; color:var(--dsw-alias-label-secondary,#aaa); }
.elysium-detail-panel .elysium-panel-body { padding:16px 18px 20px; }
.elysium-detail-panel .elysium-episode-section { padding:14px 0 4px; }
.elysium-detail-panel .elysium-production-step { padding:14px 16px 16px; }
.elysium-detail-panel .elysium-episode-section > header { padding:0 16px 10px; }
.elysium-detail-panel .elysium-generating-notice { margin-bottom:12px; }
.elysium-detail-panel[data-collapsed=true] .elysium-app-navbar { padding:8px 3px; border:0; min-height:0; }
.elysium-detail-panel[data-collapsed=true] .elysium-app-navbar h1 { display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; white-space:normal; overflow-wrap:anywhere; word-break:break-word; font-size:11px; font-weight:500; line-height:1.25; text-align:center; }
.elysium-detail-panel[data-collapsed=true] .elysium-app-navbar > button,.elysium-detail-panel[data-collapsed=true] .elysium-step-detail-body,.elysium-detail-panel[data-collapsed=true] .elysium-step-detail-footer,.elysium-detail-panel[data-collapsed=true] .elysium-series-empty > p,.elysium-detail-panel[data-collapsed=true] .elysium-series-empty > strong { display:none; }
.elysium-detail-panel[data-collapsed=true] .elysium-project-workflow { margin:0; }
@container elysium-series (max-width:440px) { .elysium-shot-form-grid { grid-template-columns:minmax(0,1fr); } .elysium-edit-section { padding:14px; } .elysium-panel .elysium-episode-card { flex-basis:190px; } .elysium-app-navbar h1 { font-size:14px; } }
`
}) })
