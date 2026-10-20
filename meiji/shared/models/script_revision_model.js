import { defaultRules } from '../rule-defaults.js';
import { emptyNodeStateModel } from './node_state_model.js';

// 只保存当前优化稿；原稿由 basic_info.original_script 独立保存。
export const emptyScriptRevisionModel = () => ({
  opinion: '', body: '', rules: defaultRules('script-review'), node_state: emptyNodeStateModel(),
});
