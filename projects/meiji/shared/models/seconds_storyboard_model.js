import { defaultRules } from '../rule-defaults.js';
// 单镜每秒分镜节点模型。
import { emptyNodeStateModel } from "./node_state_model.js";
export const emptySecondsStoryboardModel = () => ({ rules: defaultRules('seconds'), node_state: emptyNodeStateModel(), storyboard: [], end_state: "", pending_actions: "", pending_dialogue: "", continuing_audio: "" });
