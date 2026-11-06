import {projectNodeStates} from '../shared/production/production_stages.js'
import { validateDocumentSchema } from "./document_validation.js";
import { projectStages } from "../shared/production/production_stages.js";
import { dramaModelSchema, createDramaModel } from './drama_model.js';

// V4短剧数据契约。此模块不创建节点、不调用模型、不迁移磁盘文件。
const string = (minLength = 0) => ({ type: "string", minLength });
const number = (minimum = 0) => ({ type: "number", minimum });
const integer = (minimum = 0) => ({ type: "integer", minimum });
const array = (items) => ({ type: "array", items });
const object = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const nullable = (schema) => ({ oneOf: [schema, { type: "null" }] });
const id = string(1),
  ids = array(id),
  ref = string(1),
  optionalRef = nullable(ref);
const mediaBinding = object({ image_id: id, role: string(1) });
const dialogue = object({
  id,
  speaker_id: id,
  text: string(1),
  delivery: object({
    emotion: string(),
    volume: string(),
    pace: string(),
    breath: string(),
  }),
});
const assetBase = {
  id,
  name: string(1),
  description: string(),
  image_ids: ids,
  selected_image_id: nullable(id),
};
const nodeState = (stage) => object({
  status: {
    type: "string",
    enum: ["empty", "partial", "draft", "confirmed", "rejected"],
  },
  product_revision: integer(),
  opinion: string(),
  reason: string(),
  ...(stage.kind !== 'program' ? { rules: object({ generate: string(), review: string(), revise: string() }) } : {}),
  ...(stage.kind === 'ai' ? { checkpoint: nullable(
    object({
      task_id: id,
      unit_id: id,
      unit_ref: ref,
      candidate_ref: ref,
      state: { type: "string", enum: ["saved", "reviewed"] },
      product_revision: integer(),
    }),
  ) } : {}),
});

export { projectStages } from "../shared/production/production_stages.js";

const productSchemas = {
  source: object({
    current_revision_id: nullable(id),
    revisions: array(
      object({
        id,
        file_ref: ref,
        original_name: string(1),
        character_count: integer(),
      }),
    ),
  }),
  source_analysis: object({
    source_revision_id: nullable(id),
    chapters: array(
      object({
        id,
        sequence: integer(1),
        title: string(1),
        body: string(1),
        summary: string(),
      }),
    ),
    coverage_ref: optionalRef,
  }),
  adaptation_plan: dramaModelSchema.properties.data.properties.adaptation_plan,
  story_segments: object({
    segments: array(
      object({
        id,
        sequence: integer(1),
        revision: integer(1),
        title: string(1),
        body_ref: ref,
        continuity_ref: optionalRef,
      }),
    ),
  }),
  asset_library: object({
    characters: array(
      object({
        ...assetBase,
        character_plan_id: nullable(id),
        voice_profile: object({
          description: string(),
          reference_audio_ref: optionalRef,
          revision: integer(),
        }),
      }),
    ),
    clothing: array(object({ ...assetBase, group_key: string() })),
    props: array(object({ ...assetBase })),
    scenes: array(
      object({
        ...assetBase,
        scene_plan_id: nullable(id),
        layout: string(),
        entrances: string(),
        landmarks: string(),
      }),
    ),
    character_looks: array(
      object({
        ...assetBase,
        character_id: id,
        clothing_ids: ids,
        prop_ids: ids,
        hair_and_makeup: string(),
      }),
    ),
  }),
  asset_requirements: object({
    items: array(
      object({
        id,
        kind: {
          type: "string",
          enum: ["character", "clothing", "prop", "scene", "character_look"],
        },
        target_id: id,
        shot_ids: ids,
        strategy: { type: "string", enum: ["reuse", "import", "generate"] },
        status: {
          type: "string",
          enum: ["pending", "running", "ready", "failed"],
        },
        image_id: nullable(id),
      }),
    ),
  }),
  shot_design: object({
    shots: array(
      object({
        id,
        sequence: integer(1),
        revision: integer(1),
        story_segment_id: id,
        story_segment_revision: integer(1),
        scene_id: nullable(id),
        characters: array(
          object({
            character_id: id,
            look_id: nullable(id),
            opening_state: string(),
          }),
        ),
        props: array(
          object({
            prop_id: id,
            holder_character_id: nullable(id),
            opening_state: string(),
          }),
        ),
        reference_images: array(mediaBinding),
        beats: array(
          object({
            id,
            duration_seconds: number(),
            action: string(),
            camera: string(),
            scene_changes: string(),
            effects: string(),
            dialogues: array(dialogue),
            soundscape: string(),
            music: string(),
          }),
        ),
      }),
    ),
  }),
  clip_arrangement: object({
    clips: array(
      object({
        id,
        sequence: integer(1),
        duration_seconds: integer(4),
        sources: array(object({ shot_id: id, beat_ids: ids })),
        mode: { type: "string", enum: ["text", "reference", "first_frame"] },
        first_image_id: nullable(id),
        last_image_id: nullable(id),
      }),
    ),
  }),
  video_prompt: object({
    items: array(
      object({
        id,
        clip_id: id,
        mode: { type: "string", enum: ["text", "reference", "first_frame"] },
        revision: integer(1),
        prompt_ref: ref,
        reference_images: array(mediaBinding),
        voice_references: array(
          object({
            character_id: id,
            voice_revision: integer(),
            audio_ref: ref,
          }),
        ),
      }),
    ),
  }),
  videos: array(
    object({
      id,
      clip_id: id,
      mode: { type: "string", enum: ["text", "reference", "first_frame"] },
      prompt_id: id,
      prompt_revision: integer(1),
      file_ref: ref,
      duration_seconds: number(),
      input_snapshot_ref: ref,
      reference_image_ids: ids,
      voice_references: array(
        object({ character_id: id, voice_revision: integer(), audio_ref: ref }),
      ),
      status: { type: "string", enum: ["candidate", "approved", "rejected"] },
    }),
  ),
  editing: object({
    preview_ref: optionalRef,
    timelines: array(
      object({
        id,
        name: string(1),
        revision: integer(1),
        clips: array(
          object({
            id,
            take_id: id,
            in_seconds: number(),
            out_seconds: number(),
            position_seconds: number(),
          }),
        ),
        transitions: array(object({ clip_id: id, duration_seconds: number() })),
        subtitles_ref: optionalRef,
        audio_tracks_ref: optionalRef,
      }),
    ),
  }),
  episodes: array(
    object({
      id,
      title: string(1),
      timeline_id: id,
      start_seconds: number(),
      end_seconds: number(),
    }),
  ),
  delivery: object({
    settings: object({
      width: integer(16),
      height: integer(16),
      fps: integer(1),
      subtitle_mode: { type: "string", enum: ["sidecar", "burn"] },
      normalize_audio: { type: "boolean" },
    }),
    exports: array(
      object({
        id,
        timeline_id: id,
        episode_id: nullable(id),
        input_snapshot_ref: ref,
        file_ref: ref,
        subtitles_ref: optionalRef,
        validation_report_ref: optionalRef,
      }),
    ),
  }),
};
productSchemas.source_analysis.properties.chapters.items.required =
  productSchemas.source_analysis.properties.chapters.items.required.filter(
    (key) => key !== "summary",
  );
export const projectDocumentSchema = object({
  schema_version: { type: "integer", const: 4 },
  document_revision: integer(),
  basic_info: object({
    id,
    name: string(1),
    creation_mode: { type: "string", enum: ["剧本", "自由创作"] },
    aspect_ratio: {
      type: "string",
      enum: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    },
    output_language: string(1),
  }),
  ...productSchemas,
  node_states: object(
    Object.fromEntries(projectStages.filter(stage=>stage.id!=='adaptation_plan').map((stage) => [stage.id, nodeState(stage)])),
  ),
});

export function createProjectDocument({
  id: projectId,
  name,
  creation_mode = "剧本",
  aspect_ratio = "9:16",
  output_language = "zh-CN",
}) {
  const dimensions = {
      "9:16": [1080, 1920],
      "16:9": [1920, 1080],
      "21:9": [2520, 1080],
      "4:3": [1440, 1080],
      "1:1": [1080, 1080],
      "3:4": [1080, 1440],
    },
    [width, height] = dimensions[aspect_ratio] || dimensions["9:16"];
  const document = {
    schema_version: 4,
    document_revision: 0,
    basic_info: {
      id: projectId,
      name,
      creation_mode,
      aspect_ratio,
      output_language,
    },
    source: { current_revision_id: null, revisions: [] },
    source_analysis: {
      source_revision_id: null,
      chapters: [],
      coverage_ref: null,
    },
    adaptation_plan: createDramaModel({id:projectId,title:name,aspect_ratio}).data.adaptation_plan,
    story_segments: { segments: [] },
    asset_library: {
      characters: [],
      clothing: [],
      props: [],
      scenes: [],
      character_looks: [],
    },
    asset_requirements: { items: [] },
    shot_design: { shots: [] },
    clip_arrangement: { clips: [] },
    video_prompt: { items: [] },
    videos: [],
    editing: { preview_ref: null, timelines: [] },
    episodes: [],
    delivery: {
      settings: {
        width,
        height,
        fps: 24,
        subtitle_mode: "sidecar",
        normalize_audio: true,
      },
      exports: [],
    },
    node_states: Object.fromEntries(
      projectStages.filter(stage=>stage.id!=='adaptation_plan').map((stage) => [
        stage.id,
        {
          status: "empty",
          product_revision: 0,
          opinion: "",
          reason: "",
          ...(stage.kind !== 'program' ? { rules: { generate: "", review: "", revise: "" } } : {}),
          ...(stage.kind === 'ai' ? { checkpoint: null } : {}),
        },
      ]),
    ),
  };
  return assertProjectDocument(document);
}
function failure(path, message) {
  throw Object.assign(new TypeError(`${path}：${message}`), {
    code: "INVALID_PROJECT_DOCUMENT",
    path,
  });
}
export function assertProjectDocument(document) {
  validateDocumentSchema(projectDocumentSchema, document);
  const indexes = new Map();
  const index = (name, rows) => {
    const map = new Map();
    for (const row of rows) {
      if (map.has(row.id)) failure(name, "ID重复");
      map.set(row.id, row);
    }
    indexes.set(name, map);
    return map;
  };
  const requireId = (name, value, path) => {
    if (value !== null && !indexes.get(name)?.has(value))
      failure(path, `引用不存在：${value}`);
  };
  const sources = index("sources", document.source.revisions),
    chapters = index("chapters", document.source_analysis.chapters);
  const segments = index("segments", document.story_segments.segments);
  for (const [key, rows] of Object.entries(document.asset_library))
    index(key, rows);
  const shots = index("shots", document.shot_design.shots),
    clips = index("clips", document.clip_arrangement.clips),
    prompts = index("prompts", document.video_prompt.items),
    takes = index("takes", document.videos),
    timelines = index("timelines", document.editing.timelines);
  index("episodes", document.episodes);
  index("requirements", document.asset_requirements.items);
  index("exports", document.delivery.exports);
  requireId(
    "sources",
    document.source.current_revision_id,
    "source.current_revision_id",
  );
  requireId(
    "sources",
    document.source_analysis.source_revision_id,
    "source_analysis.source_revision_id",
  );
  if (chapters.size || document.source_analysis.source_revision_id) {
    if (!document.source_analysis.source_revision_id)
      failure("source_analysis", "分段缺少原稿版本");
    let length = 0;
    for (const [i, chapter] of document.source_analysis.chapters.entries()) {
      if (chapter.sequence !== i + 1)
        failure("source_analysis.chapters.sequence", "分段必须按连续顺序保存");
      length += chapter.body.length;
    }
    if (
      length !==
      sources.get(document.source_analysis.source_revision_id).character_count
    )
      failure("source_analysis.chapters.body", "分段正文长度与原稿不一致");
  }
  const assetIds = new Set();
  for (const rows of Object.values(document.asset_library))
    for (const asset of rows) {
      if (assetIds.has(asset.id)) failure("asset_library", "跨类型资产ID重复");
      assetIds.add(asset.id);
    }
  for (const [kind, rows] of Object.entries(document.asset_library))
    for (const asset of rows) {
      if (
        asset.selected_image_id !== null &&
        !asset.image_ids.includes(asset.selected_image_id)
      )
        failure(
          `asset_library.${kind}.selected_image_id`,
          "所选图片必须来自候选图片",
        );
      if (new Set(asset.image_ids).size !== asset.image_ids.length)
        failure("image_ids", "图片ID重复");
    }
  for (const character of document.asset_library.characters)
    if (character.character_plan_id !== null) failure('characters.character_plan_id', '新人物规划无ID，资产不再引用规划ID');
  for (const scene of document.asset_library.scenes)
    if (scene.scene_plan_id !== null) failure('scenes.scene_plan_id', '新场景规划无ID，资产不再引用规划ID');
  for (const look of document.asset_library.character_looks) {
    requireId("characters", look.character_id, "looks.character_id");
    for (const value of look.clothing_ids)
      requireId("clothing", value, "looks.clothing_ids");
    for (const value of look.prop_ids)
      requireId("props", value, "looks.prop_ids");
  }
  for (const [name, rows] of [
    ["story_segments.segments", document.story_segments.segments],
    ["shot_design.shots", document.shot_design.shots],
    ["clip_arrangement.clips", document.clip_arrangement.clips],
  ]) {
    const sequences = new Set();
    for (const row of rows) {
      if (sequences.has(row.sequence))
        failure(name, "sequence必须全局唯一，请读取已有顺序再分配");
      sequences.add(row.sequence);
    }
  }
  const beatIndex = new Map(),
    dialogueIds = new Set();
  for (const shot of shots.values()) {
    requireId("segments", shot.story_segment_id, "shots.story_segment_id");
    requireId("scenes", shot.scene_id, "shots.scene_id");
    for (const row of shot.characters) {
      requireId("characters", row.character_id, "shots.characters");
      requireId("character_looks", row.look_id, "shots.look_id");
      if (
        row.look_id &&
        indexes.get("character_looks").get(row.look_id).character_id !==
          row.character_id
      )
        failure("shots.look_id", "造型不属于当前人物");
    }
    for (const row of shot.props) {
      requireId("props", row.prop_id, "shots.props");
      requireId(
        "characters",
        row.holder_character_id,
        "shots.props.holder_character_id",
      );
    }
    for (const beat of shot.beats) {
      if (beatIndex.has(beat.id)) failure("beats", "节拍ID重复");
      if (beat.duration_seconds <= 0)
        failure("beats.duration_seconds", "时长必须大于0");
      beatIndex.set(beat.id, { shot, beat });
      for (const line of beat.dialogues) {
        if (dialogueIds.has(line.id)) failure("dialogues", "对白ID重复");
        dialogueIds.add(line.id);
        requireId("characters", line.speaker_id, "dialogues.speaker_id");
      }
    }
  }
  for (const item of document.asset_requirements.items) {
    requireId(
      {
        character: "characters",
        clothing: "clothing",
        prop: "props",
        scene: "scenes",
        character_look: "character_looks",
      }[item.kind],
      item.target_id,
      "asset_requirements.target_id",
    );
    for (const value of item.shot_ids)
      requireId("shots", value, "asset_requirements.shot_ids");
    if (item.status === "ready" && !item.image_id)
      failure("asset_requirements.image_id", "已齐备需求必须指定真实图片ID");
  }
  for (const clip of clips.values()) {
    if (clip.duration_seconds > 15)
      failure("clips.duration_seconds", "当前H3生成时长不能超过15秒");
    if (
      (clip.mode === "text" && (clip.first_image_id || clip.last_image_id)) ||
      (clip.mode === "reference" && (clip.first_image_id || clip.last_image_id))
    )
      failure("clips", "生成模式与首尾帧互斥");
    if (clip.mode === "first_frame" && !clip.first_image_id)
      failure("clips.first_image_id", "首尾帧模式需要首帧");
    for (const row of clip.sources) {
      requireId("shots", row.shot_id, "clips.sources.shot_id");
      for (const beat of row.beat_ids)
        if (beatIndex.get(beat)?.shot.id !== row.shot_id)
          failure("clips.sources.beat_ids", "节拍不属于指定镜头");
    }
  }
  for (const prompt of prompts.values()) {
    requireId("clips", prompt.clip_id, "video_prompt.clip_id");
    if (
      prompt.reference_images.length > 9 ||
      prompt.voice_references.length > 3
    )
      failure("video_prompt", "参考素材数量超限");
    const clip = clips.get(prompt.clip_id);
    if (
      prompt.mode !== "reference" &&
      (prompt.reference_images.length || prompt.voice_references.length)
    )
      failure("video_prompt", "当前模式不支持参考图/音频");
    for (const voice of prompt.voice_references)
      requireId(
        "characters",
        voice.character_id,
        "video_prompt.voice_references",
      );
  }
  for (const take of takes.values()) {
    requireId("clips", take.clip_id, "videos.clip_id");
    requireId("prompts", take.prompt_id, "videos.prompt_id");
    if (prompts.get(take.prompt_id).clip_id !== take.clip_id)
      failure("videos.prompt_id", "提示词不属于本分片");
    if (take.duration_seconds <= 0)
      failure("videos.duration_seconds", "实际时长必须大于0");
  }
  for (const timeline of timelines.values())
    for (const row of timeline.clips) {
      requireId("takes", row.take_id, "editing.take_id");
      if (
        row.out_seconds <= row.in_seconds ||
        row.out_seconds > takes.get(row.take_id).duration_seconds
      )
        failure("editing", "剪辑范围超出实际素材");
    }
  for (const timeline of timelines.values()) {
    const clips = timeline.clips;
    for (const transition of timeline.transitions) {
      if (
        !clips.some((row) => row.id === transition.clip_id) ||
        transition.duration_seconds <= 0
      )
        failure("editing.transitions", "转场引用或时长无效");
    }
    const sorted = [...clips].sort(
      (a, b) => a.position_seconds - b.position_seconds,
    );
    let end = 0;
    for (const row of sorted) {
      if (row.position_seconds < end - 0.001)
        failure("editing", "时间线片段不能重叠");
      end = row.position_seconds + row.out_seconds - row.in_seconds;
    }
  }
  for (const episode of document.episodes) {
    requireId("timelines", episode.timeline_id, "episodes.timeline_id");
    if (
      episode.end_seconds <= episode.start_seconds ||
      episode.end_seconds >
        Math.max(
          0,
          ...timelines
            .get(episode.timeline_id)
            .clips.map(
              (row) => row.position_seconds + row.out_seconds - row.in_seconds,
            ),
        ) +
          0.05
    )
      failure("episodes", "分集范围无效");
  }
  // 导出属于不可变input_snapshot_ref，历史集界和时间线不依赖当前编辑稿。

  if (
    document.delivery.settings.width > 4096 ||
    document.delivery.settings.height > 4096 ||
    document.delivery.settings.width % 2 ||
    document.delivery.settings.height % 2 ||
    document.delivery.settings.fps > 60
  )
    failure("delivery.settings", "输出宽高需为16～4096偶数，帧率1～60");
  return structuredClone(document);
}

export function editProjectProduct(
  document,
  stageId,
  value,
  { expectedRevision } = {},
) {
  assertProjectDocument(document);
  const stage = projectStages.find((row) => row.id === stageId);
  if (!stage) failure("stage", "未知制作步骤");
  const current = projectNodeStates(document)[stageId];
  if (stageId !== 'adaptation_plan' && expectedRevision !== current.product_revision)
    throw Object.assign(new Error("产物已被修改，请刷新后重新编辑"), {
      code: "EDIT_CONFLICT",
    });
  const next = structuredClone(document);
  if (stageId === "delivery") {
    if (!value || Object.keys(value).sort().join(",") !== "delivery,episodes")
      failure("delivery", "交付编辑须包含episodes与delivery");
    next.episodes = structuredClone(value.episodes);
    next.delivery = structuredClone(value.delivery);
  } else if (stageId === "shot_design") {
    if (
      !value ||
      Object.keys(value).sort().join(",") !== "asset_requirements,shot_design"
    )
      failure("shot_design", "分镜编辑须包含shot_design与asset_requirements");
    next.shot_design = structuredClone(value.shot_design);
    next.asset_requirements = structuredClone(value.asset_requirements);
  } else if (stageId === 'adaptation_plan') {
    next.adaptation_plan.data = structuredClone(value);
    next.adaptation_plan.state.checkpoint = null;
  } else next[stage.field] = structuredClone(value);
  next.document_revision++;
  projectNodeStates(next)[stageId] = {
    ...current,
    ...(stageId!=='adaptation_plan'?{product_revision: current.product_revision + 1}:{}),
    status: "draft",
    reason: "人工修改，待重新核对",
    ...(stageId==='adaptation_plan'?{checkpoint:null}:{}),
  };
  if (stageId === "shot_design" || stageId === "reference_binding") {
    const other =
      stageId === "shot_design" ? "reference_binding" : "shot_design";
    projectNodeStates(next)[other] = {
      ...next.node_states[other],
      product_revision: projectNodeStates(next)[other].product_revision + 1,
      status: "draft",
      reason: "镜头或参考绑定已修改，待重新核对",
    };
  }
  return assertProjectDocument(next);
}
