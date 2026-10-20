// 原规则面板布局与尺寸；主题和样式封装由公共组件提供。
export const styles = `
:host{display:block;min-width:0;font:14px/1.6 system-ui;color:var(--rules-color,#e8e9ed)}
*{box-sizing:border-box}[hidden]{display:none!important}
button,input,textarea{font:inherit}button{cursor:pointer;color:inherit;background:none;border:1px solid var(--rules-border,#383a41);border-radius:8px;padding:7px 12px}
button:hover{background:var(--rules-hover,#30323a)}button:disabled{opacity:.5;cursor:default}
button:focus-visible,textarea:focus-visible,[role=tabpanel]:focus-visible{outline:2px solid var(--rules-accent,#b89e77);outline-offset:1px}
h2{font-size:18px;margin:0}h3{font-size:15px;margin:0 0 8px}p{color:var(--rules-muted,#a7aab5)}
.skill-detail-page{min-width:0;background:var(--rules-background,transparent)}.skill-page-head{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:12px}.skill-page-head h2{margin:0;overflow-wrap:anywhere}
.tabs{display:flex;gap:4px;padding:3px;background:var(--rules-tabs-background,#24262d);border-radius:8px;margin:4px 0 8px}
.tabs button{border:0;border-radius:5px;flex:1;color:var(--rules-muted,#9b9fab)}.tabs [aria-selected=true]{color:var(--rules-color,#e8e9ed);background:var(--rules-selected-background,#3a3d47)}
.skill-detail-page .settings-group{min-width:0;margin:18px 0;padding:16px;border:1px solid var(--rules-border,#383a41);border-radius:10px}
.skill-detail-page .skill-rule-tab{min-width:0}.skill-detail-page .skill-rule-card{margin:12px 0;padding:16px;border:1px solid var(--rules-border,#383a41);border-radius:10px;background:var(--rules-card-background,#1b1c21)}
.skill-detail-page .skill-supplement-card{margin-top:0}
.skill-detail-page textarea{width:100%;box-sizing:border-box;min-height:150px;background:var(--rules-input-background,#23252c);border:1px solid var(--rules-input-border,#444852);border-radius:8px;padding:10px;color:inherit;field-sizing:content;max-height:none;overflow:hidden;resize:none}
.skill-detail-page textarea[readonly]{cursor:text}
.skill-detail-page .skill-base .skill-text{margin:0;padding:0;border:0;border-radius:0;background:transparent;white-space:pre-wrap;overflow-wrap:anywhere;max-height:none;overflow:visible;font:12px/1.6 ui-monospace,monospace;color:var(--rules-color,#d7dbe6)}
.skill-rule-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}.skill-rule-head h3{margin:0}.skill-rule-head .rules-copy{margin:0;padding:3px 8px;font-size:12px;flex:none}
.skill-rule-input{display:grid;gap:6px;margin:12px 0 6px}.skill-rule-input span{font-size:13px;font-weight:650}.skill-rule-note{margin:12px 0 0;font-size:12px}
.skill-status:empty,.skill-save-status:empty{display:none}.skill-save-status{margin:0;font-size:12px}.error{color:#f2a8a8;overflow-wrap:anywhere}
@media(max-width:600px){.skill-detail-page .settings-group{padding:12px}.skill-page-head{gap:8px}}
`;
