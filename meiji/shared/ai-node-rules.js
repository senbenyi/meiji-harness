import { defaultRules } from './rule-defaults.js';
import { BUSINESS_DEFINITIONS } from './node-definitions.js';
import { nodeOf, locateTarget, invalid } from './task_contract.js';

export function supportsRules(business) {
  const d = BUSINESS_DEFINITIONS[business];
  return Boolean(d && !d.retired && (d.handler === 'text' || ['costume-image', 'scene-image', 'video'].includes(business)));
}
export function ruleNode(project, business, id) {
  if (!supportsRules(business)) invalid('business_type', '本业务不是AI节点');
  if (business === 'script-review') { locateTarget(project, business, id); return {rules:project.script.adaptation_rules,node_state:project.script.node_state}; }
  if (business === 'script-split') { locateTarget(project, business, id); return project.script; }
  return nodeOf(project, business, id);
}
// 保存的base仅作快照；展示、执行和依赖统一读取代码基础规则。
export function effectiveRules(project, business, id) {
  const saved=ruleNode(project,business,id).rules, rules=defaultRules(business);
  for(const action of ['generate','review','revise']) rules[action].supplement=saved?.[action]?.supplement ?? '';
  return rules;
}
export const ruleAction = action => action === 'regenerate' ? 'revise' : action;
export function nodeRequirements(project, business, id) {
  const episode = locateTarget(project, business, id).episode;
  return [...new Set([project.creative_direction, business === 'outline' ? episode.episode_requirements : ''].filter(value => value?.trim()))].join('\n');
}
