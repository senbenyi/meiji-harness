// 剧本正文、版本和修改历史模型。
import { emptyScriptRevisionModel } from "./script_revision_model.js";
export const emptyScriptModel = () => ({ version: 1, updated_at: "", body: "", future_plot: "", revision_history: [] });
export { emptyScriptRevisionModel };
