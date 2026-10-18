import { assertPendingDialogue } from '../../../shared/dialogue-integrity.js';
import { videoType, videoPack, previousShot, videoImages } from '../../../shared/video-inputs.js';
import { primaryCostumeImage } from "../../../shared/models/character_model.js";
import {
  nodeOf,
  locateTarget,
  invalid,
} from "../../../shared/task_contract.js";
import { assertOutput, assertOverride, hasNodeContent, TEXT_BUSINESSES } from "../../../shared/node-state.js";
import { NODE_DEFINITIONS } from "../../../shared/node-definitions.js";
import { isNodeCurrent } from "../../../shared/node-dependencies.js";

export function precheck(snapshot, task, { libraryReferences = [] } = {}) {
  const p = snapshot.project,
    { object, episode, character } = locateTarget(
      p,
      task.business_type,
      task.target_id,
    ),
    node = nodeOf(p, task.business_type, task.target_id),
    original = task.previous_node_state?.status;
  const requireNode = (business, id, label = business) => {
    const n = nodeOf(p, business, id);
    if (n.node_state.status !== "generated") invalid("precheck", `${label}尚未有效生成`);
    assertOutput(p, business, id);
    if (!isNodeCurrent(snapshot, business, id)) invalid("precheck", `${label}依赖已过期，请重新生成`);
  };
  if (task.business_type === 'seconds') {
    const previous = previousShot(episode, object);
    if (previous) {
      requireNode('seconds', previous.id, `前镜 ${previous.number} 每秒分镜`);
      assertPendingDialogue(previous.seconds_storyboard, `前镜 ${previous.number} 交接资料`);
    }
  }
  if (task.action === "override") {
    if (task.business_type === "script-split") return { passed: true };
    const programNode = ["first-last-frame", "multimodal", "assembly"].includes(task.business_type);
    if ((!TEXT_BUSINESSES.includes(task.business_type) && !programNode) || original !== "rejected")
      invalid("precheck", "只允许放行结构有效的未通过文本");
    assertOverride(p, task.business_type, task.target_id);
    return { passed: true };
  }
  if (task.action === "manual_edit") return { passed: true };
  if (task.action === "delete") {
    if (libraryReferences.includes(task.target_id))
      invalid("precheck", "素材库仍引用目标");
    if (task.business_type === "character-delete") {
      for (const e of p.episodes) {
        if (
          e.shot_list.shots.some(
            (s) =>
              s.on_screen_characters.some((r) => r.character_id === object.id) ||
              s.seconds_storyboard.storyboard.some((b) =>
                b.dialogue.some((d) => d.speaker_id === object.id),
              ),
          )
        )
          invalid("precheck", "角色仍被项目内容引用");
      }
    } else if (character.default_costume_id === object.id)
      invalid("precheck", "不能删除默认服装");
    return { passed: true };
  }
  // 剧本节点的内容就是剧本，首次审核时已有内容。
  if (task.action === "generate" && node && task.business_type !== "script-review" && hasNodeContent(p, task.business_type, task.target_id))
    invalid("precheck", "已有内容请重新生成");
  if (["regenerate", "revise"].includes(task.action) && node && !hasNodeContent(p, task.business_type, task.target_id))
    invalid("precheck", "未生成节点请使用生成");
  const business = task.business_type;
  if (business === "script-split") {
    if (!p.script.body.trim()) invalid("precheck", "剧本为空");
    if (!Number.isInteger(p.reference_episode_duration_seconds) || p.reference_episode_duration_seconds < 1)
      invalid("precheck", "缺少参考单集时长");
    // 拆分会整体替换剧集；剧集上仍有未结束任务时无法替换。
    if (
      snapshot.tasks.some(
        (t) =>
          t.id !== task.id &&
          t.episode_id &&
          ["queued", "running"].includes(t.task_status),
      )
    )
      invalid("precheck", "剧集仍有未结束任务");
  }
  const runNodePrecheck = {
    "project-text": () => {
      if (!p.script.body.trim())
        invalid("precheck", "完整剧本为空");
    },
    "episode-summary": () => {
      if (!episode.plot.trim()) invalid("precheck", "本集剧情为空");
    },
    outline: () => {
      if (!episode.plot.trim())
        invalid("precheck", "本集剧情为空，请先填写剧情或全集规划");
    },
    'episode-scenes': () => { requireNode('outline', episode.id); },
    'scene-image': () => { if (![object.name, object.description, object.layout].some(value => value.trim())) invalid('precheck','场景资料为空'); },
    shots: () => { requireNode("outline", episode.id); requireNode('episode-scenes', episode.id, '提取场景'); requireNode("project-characters", p.id); },
    seconds: () => {
      requireNode("shots", episode.id);
      requireNode("project-characters", p.id);
    },
    storyboard: () => {
      requireNode("project-characters", p.id);
      requireNode("shots", episode.id);
      requireNode("seconds", object.id);
    },
    'video-pack': () => {
      requireNode('shots', episode.id);
      requireNode('storyboard', object.id);
      const type = videoType(p, episode, object);
      if (videoPack(type) !== business) invalid('precheck', '视频类型已变化，请重新提交视频任务');
      if (type === '多模态') {
        const refs = videoImages(p, object);
        if (refs.length > 9) invalid('precheck', '人物与场景参考图合计最多9张');
      } else requireNode('tail', previousShot(episode, object).id);
    },
    video: () => {
      requireNode('shots', episode.id);
      requireNode('storyboard', object.id);
      const type = videoType(p, episode, object), pack = videoPack(type);
      if (object.video_generation_type !== type) invalid('precheck', '视频类型尚未确定');
      if (pack) requireNode(pack, object.id);
      if (type === '首尾帧') requireNode('tail', previousShot(episode, object).id);
    },
    assembly: () => {
      if (!episode.shot_list.shots.length) invalid("precheck", "没有镜头");
      for (const shot of episode.shot_list.shots) requireNode("video", shot.id);
    },
    "character-image": () => invalid("precheck", "独立角色图已移除，请生成定妆照"),
    "costume-image": () => {
      if (!object && character.costumes.length)
        invalid("precheck", "已有明确服装，请选择对应服装生成定妆照");
      if (![character.name, character.position, character.gender, character.era, character.age_range, character.body_type,
        character.hairstyle, ...character.signature_props, ...character.immutable_traits].some(value => value.trim()))
        invalid("precheck", "角色资料为空，请至少填写一项人物资料");
      const primary = primaryCostumeImage(character);
      if (primary.costume_id !== (object?.id || ""))
        requireNode("costume-image", primary.costume_id || character.id);
    },
  };
  const precheckKey = NODE_DEFINITIONS[business]?.precheck;
  if (precheckKey) {
    const check = runNodePrecheck[precheckKey];
    if (!check) invalid("precheck", `未定义节点前置检查：${precheckKey}`);
    check();
  }
  return { passed: true, business_type: business, target_id: task.target_id };
}
