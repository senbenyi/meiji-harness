import { element } from './panel-dom.js';
const labels={queued:'排队中',running:'生成中',completed:'已完成',rejected:'未通过',failed:'失败',cancelled:'已取消',superseded:'已取消'};
export function latestNodeTask(tasks,business,id) {
  const related=tasks.filter(t=>t.business_type===business&&t.target_id===id).sort((a,b)=>b.queue_order-a.queue_order);
  return related.find(t=>['queued','running'].includes(t.task_status)) || related[0];
}
export function taskStatusRow(task) {
  if(!task)return null;
  const failure=task.task_status==='failed'&&task.end_reason?`，原因：${task.end_reason}`:'';
  return element('p',`最新任务：${labels[task.task_status]||task.task_status}${failure}`,'node-ui-task-status');
}
