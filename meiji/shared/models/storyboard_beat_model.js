// 每秒分镜中的单个节拍模型。
import { emptyDialogueModel } from "./dialogue_model.js";
export const emptyStoryboardBeatModel = () => ({ start_seconds: 0, end_seconds: 0, action: "", camera: "", space: "", voice: "", dialogue: [], handoff: "" });
export { emptyDialogueModel };
