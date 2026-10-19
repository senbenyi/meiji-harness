import { defaultRules } from '../rule-defaults.js';
// 当前剧本正文、版本与修改历史；改编审核用adaptation_rules，全集规划独立使用rules。
import { emptyNodeStateModel } from "./node_state_model.js";
import { emptyScriptRevisionModel } from "./script_revision_model.js";
export const emptyScriptModel = () => ({ adaptation_rules: defaultRules('script-review'), rules: defaultRules('script-split'), version: 1, updated_at: "", body: "", future_plot: "", revision_history: [], node_state: emptyNodeStateModel() });
export { emptyScriptRevisionModel };
