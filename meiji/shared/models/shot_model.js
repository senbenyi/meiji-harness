// 单个镜头及其提示词、分镜和媒体节点模型。
import { createId } from "../task_contract.js";
import { emptyNodeStateModel } from "./node_state_model.js";
import { emptySecondsStoryboardModel } from "./seconds_storyboard_model.js";
import { emptyTextToVideoPromptModel } from "./text_to_video_prompt_model.js";
import { emptyFirstLastFramePromptModel } from "./first_last_frame_prompt_model.js";
import { emptyMultimodalPromptModel } from "./multimodal_prompt_model.js";
import { emptyVideoModel } from "./video_model.js";
import { emptyLastFrameModel } from "./last_frame_model.js";
import { emptyOnScreenCharacterModel } from "./on_screen_character_model.js";
export const emptyShotModel = (sequence = 1, fields = {}) => ({ id: createId("shot"), sequence, number: `S${String(sequence).padStart(2, "0")}`, duration_seconds: 12, actual_duration_seconds: 0, title: "", body: "", on_screen_characters: [], seconds_storyboard: emptySecondsStoryboardModel(), text_to_video_prompt: emptyTextToVideoPromptModel(), first_last_frame_prompt: emptyFirstLastFramePromptModel(), multimodal_prompt: emptyMultimodalPromptModel(), video_generation_type: "", video: emptyVideoModel(), last_frame: emptyLastFrameModel(), ...fields });
