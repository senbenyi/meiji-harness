import { emptyNodeStateModel } from './node_state_model.js';
// has_result 区分尚未识别与已返回合法空绑定；是否通过仍由 node_state 表示。
export const emptyCharacterBindingModel = () => ({ node_state: emptyNodeStateModel(), has_result: false, on_screen_characters: [] });
