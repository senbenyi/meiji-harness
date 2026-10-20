import { reviewType } from '../../shared/task-plan.js';
import { parseJsonValue } from '../prompts/parse-json.js';

export function shotProgramReview(step, steps = []) {
  return steps.filter(row => row.task_id === step.task_id && row.seq > step.seq
    && row.kind === 'review' && reviewType(row) === 'program').sort((a,b) => a.seq - b.seq)[0];
}

// replace在返回校验时已去掉mode；仅用既有审核或HTTP记录恢复校验意图，不改历史。
export function shotResultForValidation(step, steps = [], action = step.prompt?.action) {
  const value = step.result;
  if (action !== 'regenerate' || value?.mode !== undefined || !Array.isArray(value?.shots) || !value.shots.length)
    return value;
  if (shotProgramReview(step, steps)?.step_status === 'done') return { mode: 'replace', shots: value.shots };
  for (const transfer of [...(Array.isArray(step.http) ? step.http : [])].reverse()) {
    if (!transfer.ok) continue;
    const content = (transfer.body?.choices || transfer.body?.result?.choices)?.[0]?.message?.content;
    if (typeof content !== 'string') continue;
    let raw;
    try { raw = parseJsonValue(content); }
    catch (error) { if (error.code !== 'INVALID_MODEL_JSON') throw error; return value; }
    if (raw?.mode === 'replace' && Array.isArray(raw.shots) && raw.shots.length === value.shots.length
      && raw.shots.every((shot,index) => shot?.id === value.shots[index]?.id))
      return { mode: 'replace', shots: value.shots };
    // 只依据最近一次模型返回，不能拿旧响应替新片段声明replace。
    return value;
  }
  return value;
}
