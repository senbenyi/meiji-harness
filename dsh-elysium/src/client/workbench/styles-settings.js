// 职责：设置页大模型选择与连接状态样式。
window.__ModuleLoader__.load({ id: 'elysium/styles-settings', factory: () => ({
  css: `
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
.elysium-panel .elysium-model-row > button[role=radio] { display:flex; align-items:center; gap:10px; flex:1; min-width:0; width:auto; margin:0; min-height:28px; padding:0; border:0; border-radius:0; background:transparent; color:var(--dsw-alias-label-tertiary,#888); font-weight:400; text-align:left; box-shadow:none; }
.elysium-panel .elysium-model-row-active > button[role=radio] { color:var(--dsw-alias-label-primary,#eee); font-weight:500; background:transparent; box-shadow:none; }
.elysium-panel .elysium-model-row > button[role=radio]::before { content:''; box-sizing:border-box; flex:none; width:15px; height:15px; border:1.5px solid #6f6f6f; border-radius:50%; background:transparent; }
.elysium-panel .elysium-model-row-active > button[role=radio]::before { border-color:#d8d8d8; background:radial-gradient(circle, #eee 0 4px, transparent 4.5px); }
.elysium-panel .elysium-model-row > button[role=radio]:hover:not(:disabled) { background:transparent; border-color:transparent; color:var(--dsw-alias-label-primary,#eee); }
.elysium-settings .elysium-model-row > button:not([role=radio]) { flex:none; margin:0; min-height:24px; padding:2px 8px; border-radius:6px; font-size:12px; }
.elysium-settings article { border-top:1px solid var(--dsw-alias-border-l1,#8883); padding:10px 0; }
.elysium-settings button { margin:3px 4px 3px 0; }
`
}) })
