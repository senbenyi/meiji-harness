// 迁自历史任务面板的通用样式；仅将宿主颜色替换为公共主题变量。
export const styles = `
:host{display:block;min-width:0;font:14px/1.6 system-ui;color:var(--task-color,#e8e9ed)}
*{box-sizing:border-box}[hidden]{display:none!important}
button,select{font:inherit;color:inherit}button{cursor:pointer;background:none;border:1px solid var(--task-border,#383a41);border-radius:8px;padding:7px 12px}
button:hover{background:var(--task-hover,#30323a)}button:disabled{opacity:.5;cursor:default}
button:focus-visible,select:focus-visible{outline:2px solid var(--task-accent,#dfc196);outline-offset:2px}
h2{font-size:18px;margin:0}h3{font-size:15px;margin:0 0 8px}h4{margin:0}p{color:var(--task-muted,#a7aab5)}
.page{min-width:0;padding:0;border:0;border-radius:0;background:transparent}
.task-history-header{display:flex;align-items:center;gap:10px;flex-wrap:nowrap;margin-bottom:16px}.task-history-header h2{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.task-history-header button{flex:none;border:0;background:none;padding:4px 6px;white-space:nowrap}.task-history-header .task-history-back{display:grid;place-items:center;width:28px;height:28px;padding:0;font-size:20px}.task-history-header .task-history-refresh{margin-left:auto}.task-history-header button:hover{background:var(--task-hover,#222)}
.filters{display:flex;gap:10px;margin-bottom:15px}.filters label{display:grid;gap:5px;flex:1;min-width:0}.filters select{width:100%;background:var(--task-card-background,#23252c);border:1px solid var(--task-border,#444852);border-radius:8px;padding:10px}
.meta,.muted{font-size:12px;color:var(--task-muted,#9b9fab)}.error{color:#f2a8a8;white-space:pre-wrap;overflow-wrap:anywhere}
.task-history-list{display:grid;gap:12px}.task-history-item{border:1px solid var(--task-border,#383a41);border-radius:8px;overflow:hidden}
.task-history-status{padding:3px 8px;border-radius:12px;background:#30323a;font-size:12px;white-space:nowrap}
.task-history-status.is-completed,.task-history-status.is-done{color:#92d9ac;background:#243b30}
.task-history-status.is-running{color:#a3c8f4;background:#26384d}.task-history-status.is-queued,.task-history-status.is-ready{color:#ead0a8;background:#40392e}
.task-history-status.is-failed,.task-history-status.is-rejected{color:#f1aaaa;background:#442c31}.task-history-status.is-cancelled,.task-history-status.is-skipped{color:#c6cbd5;background:#30323a}
.run-list-row{display:grid;cursor:pointer;gap:3px;padding:7px;border:0;outline:1px solid var(--task-border,#383a41);transition:background .15s,outline-color .15s}
.run-list-row p{margin:0;line-height:1.25}.run-list-row:hover,.run-list-row:focus-visible{background:var(--task-hover,#25262d);outline-color:var(--task-accent,#dfc196)}
.run-list-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}.run-list-heading>button{min-width:0;text-align:left;overflow-wrap:anywhere}
.run-id-row{display:flex;align-items:center;gap:6px;min-width:0;margin:4px 0;font-size:11px;line-height:1.5}.run-id-row>span{flex:none}.run-id-row>code{flex:0 1 auto;min-width:0;overflow-wrap:anywhere;word-break:break-word;user-select:text}
.run-id-row>.run-id-copy{flex:none;margin:0;padding:1px 6px;min-height:0;font-size:11px;line-height:18px}
.run-group-head{margin-top:12px;padding:10px 0;border-bottom:1px solid var(--task-border,#383a41)}.run-group-head strong{white-space:normal;overflow:visible}
.run-task-head{margin-top:20px;padding-top:12px;border-top:1px solid var(--task-border,#383a41)}.run-task-head h3{margin:0;min-width:0;overflow-wrap:anywhere}.run-task-head .task-history-status{flex:none}.is-target{outline:1px solid var(--task-accent,#dfc196);outline-offset:3px}
.run-step-list{display:grid;gap:5px;width:100%;max-width:100%;margin:10px 0 0;padding:0 0 0 24px;position:relative;list-style:none}
.run-step-list::before{content:"";position:absolute;left:9px;top:6px;bottom:6px;width:1px;background:#555963}
.run-step-card{display:grid;gap:5px;margin:5px 0;padding:9px;border:1px solid var(--task-border,#383a41);border-radius:10px;background:var(--task-card-background,#1b1c21);position:relative;min-width:0;max-width:100%}
.run-step-card::before{content:attr(data-step-number);position:absolute;left:-24px;top:12px;display:grid;place-items:center;width:18px;height:18px;border-radius:50%;background:#383a41;color:#d7dbe6;font-size:11px}
.run-step-card.is-failed{border-color:#7d4e55}.run-step-card.is-failed::before{background:#7d4e55}
.run-step-summary{min-width:0;overflow-wrap:anywhere}.run-step-heading{display:flex;align-items:flex-start;gap:6px;min-width:0}.run-step-heading strong{flex:0 1 auto;min-width:0;max-width:100%;overflow-wrap:anywhere;word-break:break-word}.run-step-heading .task-history-status{flex:none;align-self:center}
.run-step-toggle{margin:0 0 0 auto;padding:3px 8px;font-size:12px}.run-step-executor{flex:none;font-size:11px;line-height:16px;padding:0 6px;border-radius:4px;border:1px solid #4a4d57;color:#a7aab5}.run-step-executor.is-ai{border-color:#5b6fa8;color:#b9c6f2}
.run-step-detail{display:grid;gap:5px;margin-top:8px;min-width:0}.run-step-detail>p{margin:0}.run-step-time{overflow-wrap:anywhere}
.run-step-error{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:7px;border-radius:8px;background:#2a2023}.run-step-error p{flex:1;min-width:0;margin:0;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}
.run-step-card:not(.is-expanded) .run-step-result pre{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;line-height:1.6;max-height:3.2em}
.run-record-page{display:grid;gap:8px;margin-top:8px}.run-record-card{display:grid;gap:5px;padding:0;border:0;background:none}.run-record-card h3,.run-record-card h4{margin:0}
pre{font:12px/1.6 ui-monospace,monospace}.run-record-card pre,.run-step-detail pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;max-height:none;overflow:visible}
.run-record-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.copy{margin:0;padding:3px 8px;font-size:12px;flex:none}
.run-record-links,.actions{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}.run-record-links button{max-width:100%;white-space:normal;padding:5px 9px}
.run-record-tabs{display:flex;gap:4px;padding:3px;background:#24262d;border-radius:8px;margin:0;flex-wrap:wrap}.run-record-tabs button{border:0;border-radius:5px;flex:1;color:#9b9fab}.run-record-tabs [aria-selected=true]{color:#e8e9ed;background:#3a3d47}
.metadata{font-size:12px;margin:10px 0}.metadata pre{white-space:pre-wrap;overflow-wrap:anywhere}summary{cursor:pointer}.notice:empty{display:none}
@media(max-width:480px){button,select{max-width:100%}.run-step-heading{flex-wrap:wrap}}
`;
