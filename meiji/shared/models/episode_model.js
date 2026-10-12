// 剧集及其摘要、大纲、镜头表和合片模型。
import { createId } from "../task_contract.js";
import { emptyEpisodeSummaryModel } from "./episode_summary_model.js";
import { emptyStoryOutlineModel } from "./story_outline_model.js";
import { emptyShotListModel } from "./shot_list_model.js";
import { emptyAssemblyModel } from "./assembly_model.js";
export const emptyEpisodeModel = (sequence = 1, duration_seconds = 150, fields = {}) => ({ id: createId("episode"), sequence, duration_seconds, actual_duration_seconds: 0, episode_requirements: "", plot: "", cover: "", summary: emptyEpisodeSummaryModel(), story_outline: emptyStoryOutlineModel(), shot_list: emptyShotListModel(), assembly: emptyAssemblyModel(), ...fields });
