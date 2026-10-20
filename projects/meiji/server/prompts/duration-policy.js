// 仅从现有节点输入派生，不存入项目，也不改变依赖hash。
// 只读取独立头部的明确声明；“约”“左右”和剧情中的时长不作为硬预算。
export function declaredStoryDuration(script) {
  const line = script.match(/^\s*(?:总时长|总片长|全剧时长)\s*[:：]\s*([^\n（(]+)/m)?.[1].trim();
  if (!line) return null;
  const value = line.match(/^(?:(\d+)\s*(?:分钟|分)\s*)?(?:(\d+)\s*秒)?$/);
  if (!value || (!value[1] && !value[2])) return null;
  const seconds = Number(value[1] || 0) * 60 + Number(value[2] || 0);
  return seconds > 0 ? seconds : null;
}
export function splitBudget(duration, total = null) {
  const budget = { target_seconds: duration, min_seconds: Math.max(1, Math.ceil(duration - 30)), max_seconds: Math.floor(duration + 30), tolerance_seconds: 30 };
  if (total === null) return budget;
  const min = Math.ceil(total / budget.max_seconds), max = Math.floor(total / budget.min_seconds);
  return { ...budget, total_seconds: total, min_episodes: min, max_episodes: max,
    preferred_episodes: min <= max ? Math.max(min, Math.min(max, Math.round(total / duration))) : null };
}
export function outlineBudget(duration) {
  return { target_seconds: duration, min_seconds: Math.max(1, duration - 30), max_seconds: duration + 30, tolerance_seconds: 30 };
}
export function shotsBudget(segments, referenceDuration) {
  let sum = 0, previous = 0;
  const rows = segments.map(segment => {
    sum += segment.duration_seconds;
    const end = Math.round(sum), budget = end - previous;
    previous = end;
    return { sequence: segment.sequence, budget_seconds: budget,
      min_shots: Math.max(1, Math.ceil(budget / 15)), max_shots: Math.floor(budget / 4) };
  });
  const target = Math.round(sum);
  const reference = referenceDuration ?? target;
  return { target_seconds: target, reference_seconds: reference,
    min_seconds: Math.max(4, target - 30, Math.ceil(reference - 30)),
    max_seconds: Math.min(target + 30, Math.floor(reference + 30)),
    shot_min_seconds: 4, shot_max_seconds: 15, segments: rows };
}
