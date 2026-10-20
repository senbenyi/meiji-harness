import { defaultRules } from '../rule-defaults.js';
// 分集改编节点模型，正文由segments[].body按序拼接。
import { emptyNodeStateModel } from "./node_state_model.js";
export const emptyStoryOutlineModel = () => ({ rules: defaultRules('outline'), node_state: emptyNodeStateModel(), segments: [] });
