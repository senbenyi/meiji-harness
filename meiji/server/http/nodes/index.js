import { reviewPolicy } from '../../prompts/review-policy.js';
import node0 from './costume-image.js';
import node1 from './episode-summary.js';
import node2 from './outline.js';
import node3 from './project-characters.js';
import node4 from './project-summary.js';
import node5 from './script-split.js';
import node6 from './seconds.js';
import node7 from './shots.js';
import node8 from './storyboard.js';
import node9 from './video.js';

import episodeScenes from './episode-scenes.js';
import sceneImage from './scene-image.js';
const routes = {
  'episode-scenes': episodeScenes, 'scene-image': sceneImage,
  'costume-image': node0,
  'episode-summary': node1,
  'outline': node2,
  'project-characters': node3,
  'project-summary': node4,
  'script-split': node5,
  'seconds': node6,
  'shots': node7,
  'storyboard': node8,
  'video': node9,
};

// 公共审核扩展只编排一次；渲染、HTTP校验和规则面板读取同一契约。
export const nodeRoutes = Object.fromEntries(Object.entries(routes).map(([node, route]) => {
  if (!route.actions.review) return [node, route];
  const resolved = reviewPolicy(node, 'review', route, route.actions.review);
  return [node, { ...resolved.route, actions: { ...route.actions, review: resolved.contract } }];
}));
