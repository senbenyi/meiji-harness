// 仅从现有节点输入派生，不存入项目，也不改变依赖hash。
export function splitBudget(duration) {
  return { target_seconds: duration, min_seconds: Math.ceil(duration * 0.8), max_seconds: Math.floor(duration * 1.2) };
}
export function outlineBudget(duration) {
  return { target_seconds: duration, min_seconds: Math.max(1, duration - 30), max_seconds: duration + 30, tolerance_seconds: 30 };
}
export function shotsBudget(segments) {
  let sum = 0, previous = 0;
  const rows = segments.map(segment => {
    sum += segment.duration_seconds;
    const end = Math.round(sum), budget = end - previous;
    previous = end;
    return { sequence: segment.sequence, budget_seconds: budget,
      min_shots: Math.max(1, Math.ceil(budget / 15)), max_shots: Math.floor(budget / 4) };
  });
  const target = Math.round(sum);
  return { target_seconds: target, min_seconds: Math.max(4, target - 30), max_seconds: target + 30,
    shot_min_seconds: 4, shot_max_seconds: 15, segments: rows };
}
