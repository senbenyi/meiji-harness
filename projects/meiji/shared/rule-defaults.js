import { dialoguePaceRule } from './prompt-models/common.js';
import scriptReview from './prompt-models/script-review.js';
import summary from './prompt-models/project-summary.js';
import characters from './prompt-models/project-characters.js';
import split from './prompt-models/script-split.js';
import episodeSummary from './prompt-models/episode-summary.js';
import outline from './prompt-models/outline.js';
import scenes from './prompt-models/episode-scenes.js';
import shots from './prompt-models/shots.js';
import seconds from './prompt-models/seconds.js';
import storyboard from './prompt-models/storyboard.js';
import costume from './prompt-models/costume-image.js';
import sceneImage from './prompt-models/scene-image.js';

const models = { 'script-review': scriptReview, 'project-summary': summary, 'project-characters': characters, 'script-split': split,
  'episode-summary': episodeSummary, outline, 'episode-scenes': scenes, shots, seconds, storyboard,
  'costume-image': costume, 'scene-image': sceneImage };
export const videoRules = {
  generate: '按下文分镜连续呈现画面、动作与声音，保持人物身份、服装、场景布局、持物和行动进度一致，动作以分镜所描述的真实速度与节奏推进。' + '\n' + dialoguePaceRule,
  revise: '按下文分镜及本次修改意见呈现画面、动作与声音，保持已确认的人物身份、服装、场景布局与前后动作连续。' + '\n' + dialoguePaceRule,
};
export function ruleText(value) {
  return typeof value === 'string' ? value : Object.entries(value || {}).map(([key, child]) => `${key}：\n${ruleText(child)}`).join('\n\n');
}
// 代码是基础规则唯一来源；保存的base只作快照，执行叠加节点supplement。
export function defaultRules(business) {
  return Object.fromEntries(['generate', 'review', 'revise'].map(action => [action, {
    base: business === 'video' ? videoRules[action] || '' : ruleText(models[business]?.[action === 'revise' ? 'regenerate' : action]?.system.规则),
    supplement: '',
  }]));
}
