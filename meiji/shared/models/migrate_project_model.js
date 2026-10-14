// 将旧版项目结构转换为当前英文项目模型的数据迁移器。
import { emptyProjectModel } from "./project_model.js";
import { emptyEpisodeModel } from "./episode_model.js";
import { emptyShotModel } from "./shot_model.js";
import { emptyCharacterModel } from "./character_model.js";
import { emptyCostumeModel } from "./costume_model.js";
import { emptyScriptRevisionModel } from "./script_revision_model.js";
import { emptyStorySegmentModel } from "./story_segment_model.js";
import { emptyOnScreenCharacterModel } from "./on_screen_character_model.js";
import { emptyStoryboardBeatModel } from "./storyboard_beat_model.js";
import { emptyDialogueModel } from "./dialogue_model.js";
import { emptyRuleModel } from "./rule_model.js";
import { emptyCostumeImageModel } from "./costume_image_model.js";
import { updateEpisodeActualDuration } from "./episode_model.js";
import { nodeOf } from "../task_contract.js";
import { dependencyHash, expireDownstream } from "../node-dependencies.js";

const pick = (value, english, chinese, fallback) =>
  value?.[english] ?? value?.[chinese] ?? fallback;
const state = (value = {}) => {
  value = value.node_state ?? value;
  return ({
  status: pick(value, "status", "状态", "empty"),
  reason: pick(value, "reason", "原因", ""),
  dependency_hash: pick(value, "dependency_hash", "依赖hash", ""),
});
};
const node = (value = {}, bodyKey = "") => ({
  node_state: value.node_state ? state(value.node_state) : state(value),
  ...(bodyKey ? { [bodyKey]: pick(value, bodyKey, "正文", "") } : {}),
});
const media = (value = {}) => ({
  node_state: value.node_state ? state(value.node_state) : state(value),
  address: pick(value, "address", "地址", ""),
});

export function migrateProjectModelV3(old) {
  // 支持已按英文 Model 写入的 v3 项目，保留所有现有节点和媒体。
  if (old.project_summary) {
    const project = structuredClone(old);
    for (const character of project.character_library.characters) {
      const keys = character.costumes.length ? character.costumes.map(costume => costume.id) : [""];
      for (const key of keys)
        if (!character.costume_images.some(image => image.costume_id === key))
          character.costume_images.push(emptyCostumeImageModel(key));
    }
    return project;
  }
  const project = emptyProjectModel();
  Object.assign(project, {
    id: old.id,
    name: pick(old, "name", "名称", ""),
    creation_mode: pick(old, "creation_mode", "创作方式", "剧本"),
    aspect_ratio: pick(old, "aspect_ratio", "画幅", "1344x768"),
    creative_direction: pick(old, "creative_direction", "创作方向", ""),
    output_language: pick(old, "output_language", "输出语言", "zh-CN"),
    reference_episode_duration_seconds: pick(old, "reference_episode_duration_seconds", "参考单集时长秒", 150),
    rules: (old.rules ?? old.规则 ?? []).map((rule) => ({
      ...emptyRuleModel(),
      id: rule.id,
      scope: pick(rule, "scope", "范围", "project"),
      applicable_business_types: pick(rule, "applicable_business_types", "适用业务", []),
      node_id: pick(rule, "node_id", "节点id", ""),
      category: pick(rule, "category", "类别", "其他"),
      constraint: pick(rule, "constraint", "约束", "参考"),
      content: pick(rule, "content", "内容", ""),
    })),
    project_summary: {
      ...node(old.project_summary ?? old.项目摘要, "body"),
      script_version: pick(old.project_summary ?? old.项目摘要, "script_version", "剧本版本", 1),
    },
    script: {
      version: pick(old.script ?? old.剧本, "version", "版本", 1),
      updated_at: pick(old.script ?? old.剧本, "updated_at", "更新时间", ""),
      body: pick(old.script ?? old.剧本, "body", "正文", ""),
      future_plot: pick(old.script ?? old.剧本, "future_plot", "后续剧情", ""),
      revision_history: (pick(old.script ?? old.剧本, "revision_history", "修改记录", [])).map((row) => ({
        ...emptyScriptRevisionModel(),
        timestamp: pick(row, "timestamp", "时间", ""),
        task_id: pick(row, "task_id", "任务id", ""),
        revision_notes: pick(row, "revision_notes", "修改意见", ""),
      })),
    },
  });

  const oldLibrary = old.character_library ?? old.角色库 ?? {};
  project.character_library = {
    node_state: state(oldLibrary.node_state ?? oldLibrary),
    characters: (oldLibrary.characters ?? oldLibrary.角色 ?? []).map((oldCharacter) => {
      const character = emptyCharacterModel();
      Object.assign(character, {
        id: oldCharacter.id,
        number: pick(oldCharacter, "number", "编号", ""),
        name: pick(oldCharacter, "name", "名称", ""),
        nationality: pick(oldCharacter, "nationality", "国籍", ""),
        gender: pick(oldCharacter, "gender", "性别", ""),
        era: pick(oldCharacter, "era", "年代", ""),
        age_range: pick(oldCharacter, "age_range", "年龄段", "") || pick(oldCharacter, "age", "年龄", ""),
        height: pick(oldCharacter, "height", "身高", ""),
        body_type: pick(oldCharacter, "body_type", "体型", "") || oldCharacter.身材 || "",
        facial_features: pick(oldCharacter, "facial_features", "面相", ""),
        voice: pick(oldCharacter, "voice", "声音", ""),
        hairstyle: pick(oldCharacter, "hairstyle", "发型", ""),
        signature_props: pick(oldCharacter, "signature_props", "签名道具", ""),
        position: pick(oldCharacter, "position", "定位", "") || pick(oldCharacter, "identity", "身份", ""),
        immutable_traits: pick(oldCharacter, "immutable_traits", "不可改特征", "") || pick(oldCharacter, "identity_traits", "身份特征", ""),
        required_appearance: pick(oldCharacter, "required_appearance", "必出", false),
        default_costume_id: pick(oldCharacter, "default_costume_id", "默认服装id", ""),
        character_image: media(oldCharacter.character_image ?? oldCharacter.图片 ?? {}),
        reference_image: { address: pick(oldCharacter.reference_image ?? oldCharacter.参考图, "address", "地址", "") },
        costumes: (oldCharacter.costumes ?? oldCharacter.服装 ?? []).map((oldCostume) => {
          const costume = emptyCostumeModel();
          Object.assign(costume, {
            id: oldCostume.id,
            number: pick(oldCostume, "number", "编号", ""),
            name: pick(oldCostume, "name", "名称", ""),
            description: pick(oldCostume, "description", "描述", ""),
            color: pick(oldCostume, "color", "颜色", ""),
            material: pick(oldCostume, "material", "材质", ""),
            props: pick(oldCostume, "props", "道具", ""),
          });
          return costume;
        }),
      });
      const existingCostumeImages = oldCharacter.costume_images ?? oldCharacter.定妆照 ?? [];
      character.costume_images = existingCostumeImages.length
        ? existingCostumeImages.map((image) => ({
            ...emptyCostumeImageModel(pick(image, "costume_id", "服装id", "")),
            node_state: state(image.node_state ?? image),
            address: pick(image, "address", "地址", ""),
          }))
        : (oldCharacter.costumes ?? oldCharacter.服装 ?? []).flatMap((costume) => {
            const image = costume.character_image ?? costume.图片;
            return image ? [{
              ...emptyCostumeImageModel(costume.id),
              node_state: state(image.node_state ?? image),
              address: pick(image, "address", "地址", ""),
            }] : [];
          });
      const imageKeys = character.costumes.length ? character.costumes.map(costume => costume.id) : [""];
      for (const key of imageKeys)
        if (!character.costume_images.some(image => image.costume_id === key))
          character.costume_images.push(emptyCostumeImageModel(key));
      return character;
    }),
  };

  project.episodes = (old.episodes ?? old.剧集 ?? []).map((oldEpisode) => {
    const episode = emptyEpisodeModel(
      pick(oldEpisode, "sequence", "序号", 1),
      pick(oldEpisode, "duration_seconds", "时长秒", 150),
    );
    Object.assign(episode, {
      id: oldEpisode.id,
      actual_duration_seconds: pick(oldEpisode, "actual_duration_seconds", "实际时长秒", 0),
      episode_requirements: pick(oldEpisode, "episode_requirements", "本集要求", ""),
      plot: pick(oldEpisode, "plot", "剧情", ""),
      cover: pick(oldEpisode, "cover", "封面", ""),
      summary: { ...node(oldEpisode.summary ?? oldEpisode.摘要, "body") },
      story_outline: {
        node_state: state(oldEpisode.story_outline ?? oldEpisode.故事大纲),
        segments: (pick(oldEpisode.story_outline ?? oldEpisode.故事大纲, "segments", "小段", [])).map((segment) => ({
          ...emptyStorySegmentModel(pick(segment, "sequence", "序号", 1)),
          duration_seconds: pick(segment, "duration_seconds", "时长秒", 1),
          body: pick(segment, "body", "正文", ""),
          causal: pick(segment, "causal", "因果", ""),
        })),
      },
      assembly: media(oldEpisode.assembly ?? oldEpisode.合片 ?? {}),
    });
    const oldShotList = oldEpisode.shot_list ?? oldEpisode.镜头表 ?? {};
    episode.shot_list = {
      node_state: state(oldShotList),
      shots: (oldShotList.shots ?? oldShotList.镜头 ?? []).map((oldShot, index) => {
        const shot = emptyShotModel(pick(oldShot, "sequence", "序号", index + 1));
        Object.assign(shot, {
          id: oldShot.id,
          sequence: pick(oldShot, "sequence", "序号", index + 1),
          number: pick(oldShot, "number", "编号", ""),
          duration_seconds: pick(oldShot, "duration_seconds", "时长秒", 12),
          actual_duration_seconds: pick(oldShot, "actual_duration_seconds", "实际时长秒", 0),
          title: pick(oldShot, "title", "标题", ""),
          body: pick(oldShot, "body", "正文", ""),
          on_screen_characters: (pick(oldShot, "on_screen_characters", "出镜角色", [])).map((row) => ({
            ...emptyOnScreenCharacterModel(),
            character_id: pick(row, "character_id", "角色id", ""),
            costume_id: pick(row, "costume_id", "服装id", ""),
          })),
          video_generation_type: pick(oldShot, "video_generation_type", "视频生成类型", ""),
          video: media(oldShot.video ?? oldShot.视频 ?? {}),
          last_frame: media(oldShot.last_frame ?? oldShot.尾帧 ?? {}),
        });
        const oldAnchor = oldShot.reference_anchor ?? oldShot.参考锚点 ?? {};
        const oldAudio = oldShot.audio_arrangement ?? oldShot.音频安排 ?? {};
        const oldStoryboard = oldShot.seconds_storyboard ?? oldShot.每秒分镜 ?? {};
        const oldContent = oldStoryboard.content ?? oldStoryboard.内容 ?? {};
        const oldRows = oldStoryboard.storyboard ?? oldStoryboard.分镜
          ?? oldContent.beats ?? oldContent.节拍 ?? [];
        const storyboard = oldRows.map((oldBeat) => {
          const beat = emptyStoryboardBeatModel();
          const start = oldBeat.start_seconds ?? oldBeat.开始秒;
          const end = oldBeat.end_seconds ?? oldBeat.结束秒;
          const ranged = start != null && end != null ? `${start}–${end}s` : "";
          Object.assign(beat, {
            time_range: pick(oldBeat, "time_range", "时段", "") || ranged,
            action: pick(oldBeat, "action", "动作", ""),
            camera: pick(oldBeat, "camera", "镜头", ""),
            space: pick(oldBeat, "space", "空间", ""),
            audio: pick(oldBeat, "audio", "音频", "") || pick(oldBeat, "voice", "声音", ""),
            handoff: pick(oldBeat, "handoff", "交接", ""),
            dialogue: (pick(oldBeat, "dialogue", "对白", [])).map((oldLine) => ({
              ...emptyDialogueModel(),
              speaker_id: pick(oldLine, "speaker_id", "说话人id", ""),
              speaker_name: pick(oldLine, "speaker_name", "说话人名称", ""),
              mode: pick(oldLine, "mode", "方式", "画内"),
              dialogue_text: pick(oldLine, "dialogue_text", "台词", ""),
            })),
          });
          return beat;
        });
        const carried = [...(oldContent.ambient_sound ?? oldContent.环境声 ?? []), ...(oldContent.music ?? oldContent.配乐 ?? [])]
          .map((value) => pick(value, "body", "正文", ""))
          .filter(Boolean)
          .join("\n");
        if (carried && storyboard.length) storyboard.at(-1).audio = [storyboard.at(-1).audio, carried].filter(Boolean).join("\n");
        Object.assign(shot, {
          shot_scale: pick(oldShot, "shot_scale", "景别", ""),
          hook: pick(oldShot, "hook", "钩子", ""),
          continuity_transition: pick(oldShot, "continuity_transition", "连续性衔接", "")
            || pick(oldStoryboard, "transition_from_previous_shot", "衔接上一镜方式", ""),
          reference_anchor: {
            fixed_landmark: pick(oldAnchor, "fixed_landmark", "固定地标", ""),
            character_positions: pick(oldAnchor, "character_positions", "人物位置", ""),
            departed_characters: pick(oldAnchor, "departed_characters", "离场角色", ""),
            lighting: pick(oldAnchor, "lighting", "光位", ""),
          },
          audio_arrangement: {
            narration: pick(oldAudio, "narration", "旁白", ""),
            dialogue: pick(oldAudio, "dialogue", "对白", ""),
            sound_effects: pick(oldAudio, "sound_effects", "音效", ""),
          },
        });
        shot.seconds_storyboard = { node_state: state(oldStoryboard), storyboard };
        const oldTextPrompt = oldShot.text_to_video_prompt ?? oldShot.文本提示词 ?? {};
        const oldPromptBody = pick(oldTextPrompt, "integrated_multimodal_description", "正文", "");
        shot.text_to_video_prompt = {
          node_state: state(oldTextPrompt),
          integrated_multimodal_description: Array.isArray(oldPromptBody)
            ? oldPromptBody.map((part) => Object.values(part).filter((value) => typeof value === "string" && value).join("；")).join("\n")
            : oldPromptBody,
          overall_soundscape: pick(oldTextPrompt, "overall_soundscape", "环境声", ""),
          non_diegetic_music: pick(oldTextPrompt, "non_diegetic_music", "配乐", ""),
        };
        return shot;
      }),
    };
    return episode;
  });
  return migrateCharacterPortraitsV6(migrateCharacterListsV5(project));
}

// 仅用于显式数据库迁移；保留旧文本，不猜测分隔符或拆分原句。
export function migrateCharacterListsV5(project) {
  const convert = (object, key) => {
    if (typeof object[key] === "string") object[key] = object[key].trim() ? [object[key]] : [];
  };
  for (const character of project.character_library.characters) {
    convert(character, "signature_props");
    convert(character, "immutable_traits");
    for (const costume of character.costumes) convert(costume, "props");
  }
  return project;
}

// v4→v5：修正剧集累计时长并使旧依赖失效；不伪造新的成功指纹或改写历史。
export function migrateEpisodeNodesV4(snapshot) {
  const reason = "剧集节点依赖规则已更新，请重新生成";
  for (const episode of snapshot.project.episodes) {
    updateEpisodeActualDuration(episode);
    const entries = [
      ["outline", episode.id], ["shots", episode.id],
      ...[...episode.shot_list.shots].sort((a, b) => a.sequence - b.sequence)
        .flatMap(shot => ["seconds", "storyboard", "video", "tail"].map(business => [business, shot.id])),
      ["assembly", episode.id],
    ];
    for (const [business, id] of entries) {
      const node = nodeOf(snapshot.project, business, id);
      const queued = snapshot.tasks.find(task => task.business_type === business && task.target_id === id && task.task_status === "queued");
      const state = node.node_state.status === "queued" ? queued?.previous_node_state : node.node_state;
      if (state?.status === "expired") {
        expireDownstream(snapshot, business, id, state.reason, { compareHash: false });
        continue;
      }
      if (state?.status !== "generated" || node.node_state.dependency_hash === dependencyHash(snapshot, business, id)) continue;
      state.status = "expired";
      state.reason = reason;
      if (queued?.previous_node_state && queued.previous_node_state !== state && queued.previous_node_state.status === "generated")
        queued.previous_node_state = { status: "expired", reason };
      expireDownstream(snapshot, business, id, reason, { compareHash: false });
    }
  }
}

// v6→v7：独立角色图转为历史未绑定定妆照，保留地址和原状态。
export function migrateCharacterPortraitsV6(project) {
  for (const character of project.character_library.characters) {
    const old = character.character_image;
    if (old?.address) {
      const unbound = character.costume_images.find(image => !image.costume_id);
      if (!unbound?.address) {
        if (unbound) Object.assign(unbound, old);
        else character.costume_images.push({ ...old, costume_id: "" });
      }
    }
    delete character.character_image;
    for (const id of character.costumes.length ? character.costumes.map(costume => costume.id) : [""]) {
      if (!character.costume_images.some(image => image.costume_id === id))
        character.costume_images.push(emptyCostumeImageModel(id));
    }
  }
  return project;
}
