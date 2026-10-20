import { defaultRules } from '../rule-defaults.js';
// 文生视频提示词节点模型。
import { emptyNodeStateModel } from "./node_state_model.js";
export const emptyTextToVideoPromptModel = () => ({ rules: defaultRules('storyboard'), node_state: emptyNodeStateModel(), integrated_multimodal_description: "", overall_soundscape: "", non_diegetic_music: "" });
