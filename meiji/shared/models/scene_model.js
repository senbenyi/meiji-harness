import { defaultRules } from '../rule-defaults.js';
import { createId } from '../task_contract.js';
import { emptyNodeStateModel } from './node_state_model.js';
export const emptySceneModel = (fields = {}) => ({ id: createId('scene'), name: '', description: '', layout: '', materials: '', lighting: '', reference_image: { rules: defaultRules('scene-image'), address: '', node_state: emptyNodeStateModel() }, ...fields });
export const emptySceneCatalogModel = () => ({ rules: defaultRules('episode-scenes'), scene_ids: [], has_result: false, node_state: emptyNodeStateModel() });
