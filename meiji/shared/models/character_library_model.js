import { defaultRules } from '../rule-defaults.js';
// 项目角色库及其节点状态模型。
import { emptyNodeStateModel } from "./node_state_model.js";
export const emptyCharacterLibraryModel = () => ({ rules: defaultRules('project-characters'), node_state: emptyNodeStateModel(), characters: [] });
