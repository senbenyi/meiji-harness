import { emptyBasicInfoModel } from '../../shared/models/basic_info_model.js';
import { emptyScriptRevisionModel } from '../../shared/models/script_revision_model.js';
import { emptyNodeStateModel } from '../../shared/models/node_state_model.js';
import { defaultRules } from '../../shared/rule-defaults.js';

// 仅供显式存储升级；历史任务的提示词、HTTP和结果保持原样。
export function migrateProjectDetails(project) {
  if (project.basic_info) return project;
  const script = project.script;
  project.basic_info = emptyBasicInfoModel({
    id: project.id, name: project.name, creation_mode: project.creation_mode,
    aspect_ratio: project.aspect_ratio, creative_requirements: project.creative_direction,
    reference_episode_duration_seconds: project.reference_episode_duration_seconds,
    // 旧结构未独立保存原稿，只能保留升级时的正文作为原稿基准。
    original_script: script.body,
  });
  project.script_revision = {
    ...emptyScriptRevisionModel(), body: script.body,
    opinion: script.revision_history?.at(-1)?.revision_notes || '',
    rules: script.adaptation_rules || defaultRules('script-review'),
    ...(script.node_state ? { node_state: script.node_state } : {}),
  };
  if (script.review) project.script_revision.review = script.review;
  project.story_segments = { segments: [], rules: script.rules || defaultRules('script-split'), node_state: emptyNodeStateModel() };
  for (const key of ['id','name','creation_mode','aspect_ratio','creative_direction','reference_episode_duration_seconds','script']) delete project[key];
  return project;
}
