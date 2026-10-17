import { locateTarget } from '../../shared/task_contract.js';
const canonical = value => JSON.stringify(value?.mode === 'replace' && Array.isArray(value.shots) ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'mode')) : value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);

export function upstreamFailure(project, task, review) {
  const issues = (review.问题 || []).filter(issue => issue.修复范围 === '上游');
  if (!issues.length) return '';
  const { episode, object } = locateTarget(project, task.business_type, task.target_id);
  const location = [episode && `第${episode.sequence}集`, object?.number].filter(Boolean).join(' ');
  return `需先修正上游，停止本节点自动修订：${location}\n` + issues.map(issue =>
    `${issue.来源} · ${issue.位置}\n依据：${issue.依据}\n建议：${issue.建议}`).join('\n') + `\n审核原因：${review.原因}`;
}
const normalizeReason = value => String(value || '').replace(/[\s“”"「」『』，。、；：！？,.!?;:（）()]/gu, '');

export function revisionProgress(snapshot, task, step, review) {
  const generations = snapshot.steps.filter(s => s.task_id === task.id && ['generate', 'revise'].includes(s.kind)
    && s.step_status === 'done' && s.seq < step.seq).sort((a, b) => b.seq - a.seq);
  if (generations.length < 2) return null;
  const prior = snapshot.steps.filter(s => s.task_id === task.id && s.kind === 'review' && s.step_status === 'rejected'
    && s.seq < generations[0].seq).sort((a, b) => b.seq - a.seq)[0];
  const same = canonical(generations[0].result) === canonical(generations[1].result);
  if (!same) {
    const previous = normalizeReason(prior?.result?.原因 || prior?.error_reason);
    const current = normalizeReason(review?.原因);
    if (current.length < 20 || !previous || (previous !== current && !previous.includes(current))) return null;
    return { 候选相同: false, 重复程序错误: false, 重复审核意见: true,
      提示: `修订无进展：审核意见仍是上一轮已经指出的问题，候选改写没有消除该意见。\n${review.原因}` };
  }
  const deterministic = step.name.includes('程序审核') && prior?.name.includes('程序审核')
    && prior.result?.原因 === review.原因;
  return { 候选相同: true, 重复程序错误: deterministic,
    提示: deterministic ? `修订无进展：候选与上一轮完全相同，且重复同一程序错误；停止无效自动重试。\n${review.原因}`
      : `修订无进展：本轮候选与上一轮完全相同。请先核查最新候选与原文，历史问题已解决则不重复执行；仍存在时只修改所指出的位置，不能原样返回。\n${review.原因}` };
}
