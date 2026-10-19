import { BUSINESS_DEFINITIONS } from './node-definitions.js';
import { nodeOf, locateTarget, invalid } from './task_contract.js';

export function supportsRules(business) {
  const d = BUSINESS_DEFINITIONS[business];
  return Boolean(d && !d.retired && (d.handler === 'text' || ['costume-image', 'scene-image', 'video'].includes(business)));
}
export function ruleNode(project, business, id) {
  if (!supportsRules(business)) invalid('business_type', '本业务不是AI节点');
  if (business === 'script-split') { locateTarget(project, business, id); return project.script; }
  return nodeOf(project, business, id);
}
export const ruleAction = action => action === 'regenerate' ? 'revise' : action;
export function nodeRequirements(project, business, id) {
  const episode = locateTarget(project, business, id).episode;
  return [...new Set([project.creative_direction, business === 'outline' ? episode.episode_requirements : ''].filter(value => value?.trim()))].join('\n');
}
