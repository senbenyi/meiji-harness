import { defaultRules } from '../rule-defaults.js';
// 项目摘要节点模型。
import { emptyNodeStateModel } from "./node_state_model.js";
export const emptyProjectSummaryModel = () => ({ rules: defaultRules('project-summary'), node_state: emptyNodeStateModel(), body: "", script_version: 1 });
