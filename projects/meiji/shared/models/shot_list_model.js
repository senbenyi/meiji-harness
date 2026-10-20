import { defaultRules } from '../rule-defaults.js';
// 剧集镜头表节点模型。
import { emptyNodeStateModel } from "./node_state_model.js";
export const emptyShotListModel = () => ({ rules: defaultRules('shots'), node_state: emptyNodeStateModel(), shots: [] });
