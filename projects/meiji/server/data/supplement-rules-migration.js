import { initializeScriptAdaptation } from './script-adaptation-migration.js';
import { dependencyHash } from '../../shared/node-dependencies.js';
import { defaultRules } from '../../shared/rule-defaults.js';

function ruleRows(p) {
  const rows = [], add = (business, id, node) => { if (node) rows.push({business,id,node}); };
  add('script-split',p.basic_info.id,p.story_segments);
  add('project-summary',p.basic_info.id,p.project_summary); add('project-characters',p.basic_info.id,p.character_library);
  for (const c of p.character_library.characters) for (const image of c.costume_images || []) add('costume-image',image.costume_id || c.id,image);
  for (const scene of p.scene_library?.scenes || []) add('scene-image',scene.id,scene.reference_image);
  for (const e of p.episodes) {
    for (const [b,k] of [['episode-summary','summary'],['outline','story_outline'],['episode-scenes','scene_catalog'],['shots','shot_list']]) add(b,e.id,e[k]);
    for (const s of e.shot_list.shots) for (const [b,k] of [['seconds','seconds_storyboard'],['storyboard','text_to_video_prompt'],['video','video']]) add(b,s.id,s[k]);
  }
  return rows;
}
// 仅供显式版本迁移；正常读写必须满足新模型。
export function initializeSupplementRules(p) {
  initializeScriptAdaptation(p);
  for (const {business,node} of ruleRows(p)) if (!Object.hasOwn(node,'rules')) node.rules = defaultRules(business);
  return p;
}
export function migrateSupplementRules(p) {

  const rows = [], add = (business, id, node) => rows.push({business,id,node});

  add('project-summary', p.basic_info.id, p.project_summary);
  add('project-characters', p.basic_info.id, p.character_library);
  for (const c of p.character_library.characters) for (const image of c.costume_images)
    add('costume-image', image.costume_id || c.id, image);
  for (const scene of p.scene_library.scenes) add('scene-image', scene.id, scene.reference_image);
  for (const e of p.episodes) {
    add('episode-summary',e.id,e.summary);
    add('outline',e.id,e.story_outline);
    add('episode-scenes',e.id,e.scene_catalog);
    add('shots',e.id,e.shot_list);
    for (const s of e.shot_list.shots) {
      add('seconds',s.id,s.seconds_storyboard);
      add('storyboard',s.id,s.text_to_video_prompt);
      add('first-last-frame',s.id,s.first_last_frame_prompt);
      add('multimodal',s.id,s.multimodal_prompt);
      add('video',s.id,s.video);
      add('tail',s.id,s.last_frame);
    }
    add('assembly',e.id,e.assembly);
  }
  const snapshot = { project:p };
  const legacy = structuredClone(p);
  for (const {node} of ruleRows(legacy)) delete node.rules;
  const old = {project:legacy};
  const current = rows.filter(({business,id,node}) => {
    try { return node.node_state.status === 'generated' && [dependencyHash(old,business,id), dependencyHash(snapshot,business,id)].includes(node.node_state.dependency_hash); }
    catch { return false; }
  });
  initializeSupplementRules(p);
  for (const {business,id,node} of current) node.node_state.dependency_hash = dependencyHash(snapshot,business,id);
  return p;
}
