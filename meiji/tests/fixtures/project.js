import {
  emptyProject,
  emptyEpisode,
  emptyShot,
} from "../../shared/project_contract.js";
import { createId } from "../../shared/task_contract.js";
export function projectFixture() {
  const p = emptyProject({ 名称: "新契约测试", 创作方向: "方向" });
  p.剧本.正文 = "完整剧本";
  p.项目摘要 = { 状态: "generated", 原因: "", 依赖hash: "", 正文: "摘要", 剧本版本: 1 };
  const e = emptyEpisode({ 时长秒: 10 });
  p.剧集 = [e];
  e.摘要 = { 状态: "generated", 原因: "", 依赖hash: "", 正文: "展示摘要" };
  e.剧情 = "本集剧情原文";
  e.故事大纲 = {
    状态: "generated",
    原因: "",
    依赖hash: "",
    小段: [{ 序号: 1, 时长秒: 10, 正文: "故事" }],
  };
  e.镜头表.状态 = "generated";
  e.合片 = { 状态: "generated", 原因: "", 依赖hash: "", 地址: "film.mp4" };
  for (let n = 1; n <= 2; n++) {
    const s = emptyShot({ 序号: n, 编号: `S0${n}`, 时长秒: 5, 正文: "剧情" });
    s.每秒分镜 = {
      状态: "generated",
      原因: "",
      依赖hash: "",
      衔接上一镜方式: "尾帧衔接",
      内容: {
        事件: "事件",
        节拍: [
          {
            开始秒: 0,
            结束秒: 5,
            动作: "动作",
            镜头: "镜头",
            空间: "空间",
            声音: "声音",
            交接: "结束",
            对白: [],
          },
        ],
        环境声: [],
        配乐: [],
      },
    };
    s.文本提示词 = {
      状态: "generated",
      原因: "",
      依赖hash: "",
      正文: [
        {
          开始秒: 0,
          结束秒: 5,
          动作: "动作",
          镜头: "镜头",
          空间: "空间",
          同步声音: "声音",
          对白: "",
          心声: "",
          结尾状态: "结束",
        },
      ],
      环境声: "",
      配乐: "",
    };
    s.视频 = { 状态: "generated", 原因: "", 依赖hash: "", 地址: `${n}.mp4` };
    s.尾帧 = { 状态: "generated", 原因: "", 依赖hash: "", 地址: `${n}.png` };
    e.镜头表.镜头.push(s);
  }
  return p;
}
export function taskFixture(
  p,
  business = "seconds",
  target = p.剧集[0].镜头表.镜头[0].id,
  fields = {},
) {
  return {
    id: createId("task"),
    project_id: p.id,
    episode_id: p.剧集[0].id,
    business_type: business,
    target_id: target,
    action: "regenerate",
    group_id: null,
    group_seq: null,
    task_status: "queued",
    source: "panel",
    queue_order: 1,
    end_reason: "",
    created_at: new Date().toISOString(),
    started_at: null,
    ended_at: null,
    opinion: "",
    previous_node_state: { 状态: "generated", 原因: "" },
    ...fields,
  };
}
export const snapshotFixture = () => ({
  project: projectFixture(),
  tasks: [],
  steps: [],
  groups: [],
  runtime: { revision: 1, requests: [], queue_stopped: false, outbox: [] },
});
