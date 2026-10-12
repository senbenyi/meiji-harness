// 每秒分镜中的一秒。五项对应 H3 写提示词所需的动作、镜头、空间、音频和交接；对白另记以便绑定角色。
import { emptyDialogueModel } from "./dialogue_model.js";
export const emptyStoryboardBeatModel = () => ({ time_range: "", action: "", camera: "", space: "", audio: "", handoff: "", dialogue: [] });
export { emptyDialogueModel };
