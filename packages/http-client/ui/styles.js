// HTTP详情沿用原任务记录布局；颜色由调用方主题变量提供。
export const styles = `
.history-heading{display:flex;align-items:center;gap:10px;flex-wrap:nowrap;margin-bottom:16px}.history-heading h2{flex:1;min-width:0;white-space:nowrap}.history-heading button{flex:none;border:0;background:none;padding:4px 6px;white-space:nowrap}.history-heading .history-back{display:grid;place-items:center;width:28px;height:28px;padding:0;font-size:20px}.history-heading .history-refresh{margin-left:auto}.history-heading button:hover{background:var(--http-hover,#222)}.http-list{display:grid;gap:10px}.http-record{display:grid;gap:5px;text-align:left;min-width:0;overflow-wrap:anywhere}.http-record strong,.http-record code{overflow-wrap:anywhere;word-break:break-word}.actions{display:flex;gap:10px;margin-top:12px}

:host{display:block;min-width:0;font:14px/1.6 system-ui;color:var(--http-color,#e8e9ed)}
*{box-sizing:border-box}[hidden]{display:none!important}
button,select{font:inherit;color:inherit}button{cursor:pointer;background:none;border:1px solid var(--http-border,#383a41);border-radius:8px;padding:7px 12px}
button:hover{background:var(--http-hover,#30323a)}button:disabled{opacity:.5;cursor:default}
button:focus-visible,select:focus-visible{outline:2px solid var(--http-accent,#dfc196);outline-offset:2px}
h2{font-size:18px;margin:0}h3{font-size:15px;margin:0 0 8px}h4{margin:0}p{color:var(--http-muted,#a7aab5)}
.page{min-width:0;padding:0;border:0;border-radius:0;background:transparent}
.meta,.muted{font-size:12px;color:var(--http-muted,#9b9fab)}.error{color:#f2a8a8;white-space:pre-wrap;overflow-wrap:anywhere}
.run-id-row{display:flex;align-items:center;gap:6px;min-width:0;margin:4px 0;font-size:11px;line-height:1.5}.run-id-row>span{flex:none}.run-id-row>code{flex:0 1 auto;min-width:0;overflow-wrap:anywhere;word-break:break-word;user-select:text}
.run-id-row>.run-id-copy{flex:none;margin:0;padding:1px 6px;min-height:0;font-size:11px;line-height:18px}
.run-record-page{display:grid;gap:8px;margin-top:8px}.run-record-card{display:grid;gap:5px;padding:0;border:0;background:none}.run-record-card h3,.run-record-card h4{margin:0}
.run-record-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.copy{margin:0;padding:3px 8px;font-size:12px;flex:none}
.run-record-links,.actions{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}.run-record-links button{max-width:100%;white-space:normal;padding:5px 9px}
.run-record-tabs{display:flex;gap:4px;padding:3px;background:#24262d;border-radius:8px;margin:0;flex-wrap:wrap}.run-record-tabs button{border:0;border-radius:5px;flex:1;color:#9b9fab}.run-record-tabs [aria-selected=true]{color:#e8e9ed;background:#3a3d47}
pre{font:12px/1.6 ui-monospace,monospace;margin:0;white-space:pre-wrap;overflow-wrap:anywhere;max-height:none;overflow:visible}
`;
