import { defaultRules } from '../rule-defaults.js';
// 剧集摘要节点模型。
import { emptyNodeStateModel } from "./node_state_model.js";
export const emptyEpisodeSummaryModel = () => ({ rules: defaultRules('episode-summary'), node_state: emptyNodeStateModel(), body: "" });
