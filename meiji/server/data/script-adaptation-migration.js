import { defaultRules } from '../../shared/rule-defaults.js';
// 仅由显式版本迁移调用，不在普通读取或任务执行时补齐字段。
export function initializeScriptAdaptation(project) {
  if (!Object.hasOwn(project.script,'adaptation_rules')) project.script.adaptation_rules=defaultRules('script-review');
  return project;
}
