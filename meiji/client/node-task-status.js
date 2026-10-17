import { element } from './panel-dom.js';
import { BUSINESS_DEFINITIONS } from '../shared/node-definitions.js';
const labels={queued:'排队中',running:'生成中',completed:'已完成',rejected:'未通过',failed:'失败',cancelled:'已取消',superseded:'已取消'};
export function latestNodeTask(tasks,business,id) {
  const related=tasks.filter(t=>t.business_type===business&&t.target_id===id).sort((a,b)=>b.queue_order-a.queue_order);
  return related.find(t=>['queued','running'].includes(t.task_status)) || related[0];
}
export function taskStatusRow(task) {
  if(!task)return null;
  return element('p',`最新任务：${labels[task.task_status]||task.task_status}`,'node-ui-task-status');
}
export function taskFailureRow(task) {
  return task?.task_status === 'failed' && task.end_reason
    ? element('p', `失败原因：${task.end_reason}`, 'error node-ui-reason node-ui-failure')
    : null;
}
export function repairButtonLabel(business) {
  const rounds = BUSINESS_DEFINITIONS[business]?.retryRounds || 0;
  const name = business === 'script-review' ? '修改' : '修复';
  return rounds ? `${name}（再给 ${rounds} 轮）` : name;
}
export function revisionNote(task, steps, limit) {
  if (!task || !limit || !['queued', 'running'].includes(task.task_status)) return '';
  if (task.business_type === 'script-review' && task.action !== 'revise') return '';
  const round = (steps || []).filter(step => step.task_id === task.id && step.kind === 'revise')
    .reduce((max, step, index) => Math.max(max, Number(step.round) || index + 1), 0);
  return round ? `自动修订 ${round}/${limit}` : '';
}
export function reasonParagraph(text) {
  const paragraph = element('p', text, 'error node-ui-reason');
  if ([...text].length <= 80) return paragraph;
  paragraph.classList.add('is-clamped');
  const toggle = element('button', '展开', 'node-ui-reason-toggle');
  toggle.type = 'button';
  toggle.onclick = (event) => {
    event.preventDefault();
    const clamped = paragraph.classList.toggle('is-clamped');
    toggle.textContent = clamped ? '展开' : '收起';
  };
  const box = element('div', '', 'node-ui-reason-block');
  box.append(paragraph, toggle);
  return box;
}
