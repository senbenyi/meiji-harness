// 剧集及其摘要、大纲、镜头表和合片模型。
import { createId } from "../task_contract.js";
import { emptyEpisodeSummaryModel } from "./episode_summary_model.js";
import { emptyStoryOutlineModel } from "./story_outline_model.js";
import { emptyShotListModel } from "./shot_list_model.js";
import { emptyAssemblyModel } from "./assembly_model.js";
// 参考时长初始取拆分预算；故事大纲成功保存后取小段时长合计，允许小数秒。
export const emptyEpisodeModel = (sequence = 1, duration_seconds = 150, fields = {}) => ({ id: createId("episode"), sequence, duration_seconds, actual_duration_seconds: 0, episode_requirements: "", plot: "", cover: "", summary: emptyEpisodeSummaryModel(), story_outline: emptyStoryOutlineModel(), shot_list: emptyShotListModel(), assembly: emptyAssemblyModel(), ...fields });

// 实际时长只累计镜头视频实测值，不使用参考时长或合片文件时长。
export function updateEpisodeActualDuration(episode) {
  episode.actual_duration_seconds = Math.round(episode.shot_list.shots.reduce((sum, shot) => sum + shot.actual_duration_seconds, 0) * 10) / 10;
}
