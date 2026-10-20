import { emptyBasicInfoModel } from './basic_info_model.js';
import { emptyScriptRevisionModel } from './script_revision_model.js';
import { emptyProjectSummaryModel } from './project_summary_model.js';
import { emptyCharacterLibraryModel } from './character_library_model.js';
import { defaultRules } from '../rule-defaults.js';
import { emptyNodeStateModel } from './node_state_model.js';

export const emptyProjectModel = (fields = {}) => ({
  script_revision: emptyScriptRevisionModel(),
  story_segments: { segments: [], rules: defaultRules('script-split'), node_state: emptyNodeStateModel() },
  project_summary: emptyProjectSummaryModel(), character_library: emptyCharacterLibraryModel(),
  scene_library: { scenes: [] }, episodes: [], latest_tasks: {}, latest_groups: {},
  ...fields,
  basic_info: emptyBasicInfoModel(fields.basic_info),
});
export { emptyProjectSummaryModel, emptyScriptRevisionModel, emptyCharacterLibraryModel };
