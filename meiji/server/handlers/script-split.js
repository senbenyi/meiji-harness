import { splitBudget, declaredStoryDuration } from '../prompts/duration-policy.js';
import { scriptText } from '../../shared/script-text.js';
import { invalid, assertFields } from '../../shared/task_contract.js';

// 全集规划直接保存各集安排，不再用原文切点拼接剧情。
export function buildSplit(text, raw, referenceDuration) {
  if (!scriptText(text).trim()) invalid('全集规划', '剧本为空');
  assertFields(raw, ['剧集'], '全集规划');
  if (!Array.isArray(raw.剧集) || !raw.剧集.length) invalid('全集规划', '没有返回剧集');
  const budget = splitBudget(referenceDuration);
  const episodes = raw.剧集.map((row, index) => {
    assertFields(row, ['序号', '本集规划', '预估时长秒'], '剧集[]');
    if (row.序号 !== index + 1) invalid('全集规划.序号', '需从1连续递增');
    if (typeof row.本集规划 !== 'string' || !row.本集规划.trim()) invalid(`第${row.序号}集.本集规划`, '需为非空规划文本');
    if (!Number.isInteger(row.预估时长秒) || row.预估时长秒 < budget.min_seconds || row.预估时长秒 > budget.max_seconds)
      invalid(`第${row.序号}集.预估时长秒`, `需为${budget.min_seconds}—${budget.max_seconds}秒内的整数；按剧情容量调整集数和事件安排，不只修改数字`);
    return { sequence: row.序号, duration_seconds: row.预估时长秒, plot: row.本集规划.trim() };
  });
  const total = declaredStoryDuration(scriptText(text));
  const sum = episodes.reduce((n, episode) => n + episode.duration_seconds, 0);
  if (total !== null && sum !== total)
    invalid('全集规划.总时长', `各集合计${sum}秒，剧本头部明确总时长为${total}秒；请调整集数和事件分配，使总预算一致，不只拉长动作或缩写剧情`);
  return { episodes };
}

// 最近一次未通过的拆分任务的候选：未结束组内的任务在工作快照，已结束的经 snapshot.history 查数据库。
export function rejectedSplitCandidate(snapshot, task) {
  const live = (snapshot.tasks || [])
    .filter((row) => row.id !== task.id && row.business_type === "script-split" && row.target_id === task.target_id && row.task_status === "rejected")
    .sort((a, b) => b.queue_order - a.queue_order)[0];
  const stored = snapshot.history?.latestTask("script-split", task.target_id, task.id, "rejected") || null;
  const previous = !live ? stored : !stored || live.queue_order >= stored.queue_order ? live : stored;
  const steps = previous ? (snapshot.steps || []).filter((row) => row.task_id === previous.id) : [];
  const result = (steps.length ? steps : previous ? snapshot.history?.stepsOf(previous.id) || [] : [])
    .filter((row) => ["generate", "revise"].includes(row.kind) && row.step_status === "done")
    .sort((a, b) => b.seq - a.seq)[0]?.result;
  if (!result || !Array.isArray(result.剧集)) invalid("人工放行", "没有可收下的全集规划候选");
  return result;
}
