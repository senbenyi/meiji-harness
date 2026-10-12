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
import { emptySoundSegmentModel } from "./sound_segment_model.js";
import { emptyRuleModel } from "./rule_model.js";
import { emptyCostumeImageModel } from "./costume_image_model.js";

const pick = (value, english, chinese, fallback) =>
  value?.[english] ?? value?.[chinese] ?? fallback;
const state = (value = {}) => ({
  status: pick(value, "status", "状态", "empty"),
  reason: pick(value, "reason", "原因", ""),
  dependency_hash: pick(value, "dependency_hash", "依赖hash", ""),
});
const node = (value = {}, bodyKey = "") => ({
  node_state: value.node_state ? state(value.node_state) : state(value),
  ...(bodyKey ? { [bodyKey]: pick(value, bodyKey, "正文", "") } : {}),
});
const media = (value = {}) => ({
  node_state: value.node_state ? state(value.node_state) : state(value),
  address: pick(value, "address", "地址", ""),
});

export function migrateProjectModelV3(old) {
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
        identity: pick(oldCharacter, "identity", "身份", ""),
        identity_traits: pick(oldCharacter, "identity_traits", "身份特征", ""),
        gender: pick(oldCharacter, "gender", "性别", ""),
        era: pick(oldCharacter, "era", "年代", ""),
        age: pick(oldCharacter, "age", "年龄", ""),
        height: pick(oldCharacter, "height", "身高", ""),
        body_type: pick(oldCharacter, "body_type", "体型", ""),
        facial_features: pick(oldCharacter, "facial_features", "面相", ""),
        voice: pick(oldCharacter, "voice", "声音", ""),
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
          duration_seconds: pick(oldShot, "duration_seconds", "时长秒", 1),
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
        const oldStoryboard = oldShot.seconds_storyboard ?? oldShot.每秒分镜 ?? {};
        const oldContent = oldStoryboard.content ?? oldStoryboard.内容 ?? {};
        shot.seconds_storyboard = {
          node_state: state(oldStoryboard),
          transition_from_previous_shot: pick(oldStoryboard, "transition_from_previous_shot", "衔接上一镜方式", ""),
          content: {
            event: pick(oldContent, "event", "事件", ""),
            beats: (pick(oldContent, "beats", "节拍", [])).map((oldBeat) => {
              const beat = emptyStoryboardBeatModel();
              Object.assign(beat, {
                start_seconds: pick(oldBeat, "start_seconds", "开始秒", 0),
                end_seconds: pick(oldBeat, "end_seconds", "结束秒", 0),
                action: pick(oldBeat, "action", "动作", ""),
                camera: pick(oldBeat, "camera", "镜头", ""),
                space: pick(oldBeat, "space", "空间", ""),
                voice: pick(oldBeat, "voice", "声音", ""),
                handoff: pick(oldBeat, "handoff", "交接", ""),
                dialogue: (pick(oldBeat, "dialogue", "对白", [])).map((oldLine) => ({
                  ...emptyDialogueModel(),
                  speaker_id: pick(oldLine, "speaker_id", "说话人id", ""),
                  speaker_name: pick(oldLine, "speaker_name", "说话人名称", ""),
                  mode: pick(oldLine, "mode", "方式", "画内"),
                  performance: pick(oldLine, "performance", "表演", ""),
                  dialogue_text: pick(oldLine, "dialogue_text", "台词", ""),
                })),
              });
              return beat;
            }),
            ambient_sound: (pick(oldContent, "ambient_sound", "环境声", [])).map((value) => ({
              ...emptySoundSegmentModel(),
              start_seconds: pick(value, "start_seconds", "开始秒", 0),
              end_seconds: pick(value, "end_seconds", "结束秒", 0),
              body: pick(value, "body", "正文", ""),
            })),
            music: (pick(oldContent, "music", "配乐", [])).map((value) => ({
              ...emptySoundSegmentModel(),
              start_seconds: pick(value, "start_seconds", "开始秒", 0),
              end_seconds: pick(value, "end_seconds", "结束秒", 0),
              body: pick(value, "body", "正文", ""),
            })),
          },
        };
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
  return project;
}
