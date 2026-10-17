// 仅从现有节点输入派生，不存入项目，也不改变依赖hash。
export function splitBudget(duration) {
  return { target_seconds: duration, min_seconds: Math.max(1, Math.ceil(duration - 30)), max_seconds: Math.floor(duration + 30), tolerance_seconds: 30 };
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
