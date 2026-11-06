import { validateDocumentSchema } from './document_validation.js';

// 新项目模型；独立于 V4 运行契约，运行时不读取 docs/data。
const text = (minLength = 0) => ({ type: 'string', minLength });
const integer = (minimum = 0) => ({ type: 'integer', minimum });
const number = (minimum = 0) => ({ type: 'number', minimum });
const array = (items) => ({ type: 'array', items });
const object = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const nullable = (schema) => ({ oneOf: [schema, { type: 'null' }] });
const enumeration = (...values) => ({ type: 'string', enum: values });
const id = text(1), optionalId = nullable(id), fileRef = text(1), optionalFile = nullable(fileRef);
const mode = enumeration('text', 'reference', 'first_frame');
const aspectRatio = enumeration('21:9', '16:9', '4:3', '1:1', '3:4', '9:16');
const asset = (temporary = false) => object({ id: temporary ? optionalId : id, name: text(1), description: text(), image_id: optionalId });
// 草案中的共享引用文件尚未提供，暂沿用现有运行模型的状态及媒体引用字段。
const imageReference = object({ image_id: id, role: text(1) });
const voiceReference = object({ character_id: id, voice_revision: integer(), audio_ref: fileRef });
const stateSchema = (kind) => object({
  status: enumeration('empty', 'partial', 'draft', 'confirmed', 'rejected'),
  product_revision: integer(), opinion: text(), reason: text(),
  ...(kind !== 'program' ? { rules: object({ generate: text(), review: text(), revise: text() }) } : {}),
  ...(kind === 'text' ? { checkpoint: nullable(object({
    task_id: id, unit_id: id, unit_ref: fileRef, candidate_ref: fileRef,
    state: enumeration('saved', 'reviewed'), product_revision: integer(),
  })) } : {}),
});
const node = (nodeId, kind, data) => {
  const state = stateSchema(kind);
  if (nodeId === 'adaptation_plan') {
    delete state.properties.product_revision;
    state.required = Object.keys(state.properties);
    const checkpoint = state.properties.checkpoint.oneOf[0];
    delete checkpoint.properties.product_revision;
    checkpoint.required = Object.keys(checkpoint.properties);
  }
  return object({
  id: { type: 'string', const: nodeId },
  type: { type: 'string', const: kind === 'program' ? 'program' : 'ai' },
  data, state,
  });
};
const planItem = object({ original_content: text(1), adaptation_plan: text(1) });
const dialogue = object({
  id, kind: enumeration('dialogue', 'voice_over', 'narration', 'inner_monologue'),
  speaker_id: optionalId, text: text(1), delivery: text(), speaker_name: text(1),
});
const beat = object({
  id, duration_seconds: number(), action: text(), camera: text(), dialogues: array(dialogue), audio: text(),
});
const clip = object({
  id, sequence: integer(1), duration_seconds: integer(4),
  sources: array(object({ shot_id: id, beat_ids: array(id) })), mode,
  first_image_id: optionalId, last_image_id: optionalId,
  reference_images: array(object({ image_id: id, role: text(1), shot_ids: array(id) })),
});
const prompt = object({
  id, clip_id: id, mode, revision: integer(1), prompt_ref: fileRef,
  reference_images: array(imageReference), voice_references: array(voiceReference),
});
const video = object({
  id, clip_id: id, mode, prompt_id: id, prompt_revision: integer(1), file_ref: fileRef,
  duration_seconds: number(), input_snapshot_ref: fileRef, reference_image_ids: array(id),
  voice_references: array(voiceReference), status: enumeration('candidate', 'approved', 'rejected'),
});
const timeline = object({
  id, name: text(1), revision: integer(1),
  clips: array(object({ id, take_id: id, in_seconds: number(), out_seconds: number(), position_seconds: number() })),
  transitions: array(object({ clip_id: id, duration_seconds: number() })),
  subtitles_ref: optionalFile, audio_tracks_ref: optionalFile,
});
const episode = object({ id, title: text(1), timeline_id: id, start_seconds: number(), end_seconds: number() });
const delivery = object({
  settings: object({ width: integer(16), height: integer(16), fps: integer(1), subtitle_mode: enumeration('sidecar', 'burn'), normalize_audio: { type: 'boolean' } }),
  exports: array(object({ id, timeline_id: id, episode_id: optionalId, input_snapshot_ref: fileRef, file_ref: fileRef, subtitles_ref: optionalFile, validation_report_ref: optionalFile })),
});

export const dramaModelSchema = object({
  id, title: text(1), aspect_ratio: aspectRatio, origin_script: text(),
  data: object({
    adaptation_plan: node('adaptation_plan', 'text', object({
      audience: text(), style: text(),
      story_direction: object({ main_plot: text(), must_preserve: array(text(1)), constraints: array(text(1)) }),
      character_plans: array(planItem), group_plans: array(planItem), scene_plans: array(planItem),
    })),
    story_segments: node('story_segments', 'text', array(object({ id, title: text(1), body: fileRef }))),
    asset_preparation: node('asset_preparation', 'media', object({ characters: array(asset()), props: array(asset()), scenes: array(asset()), clothes: array(asset()) })),
    shot_design: node('shot_design', 'text', array(object({
      id, sequence: integer(1), story_segment_id: id, visual_description: text(),
      characters: array(asset(true)), clothes: array(asset(true)), props: array(asset(true)), scene: asset(true), beats: array(beat),
    }))),
    clip_arrangement: node('clip_arrangement', 'program', object({ clip_arrangement: object({ clips: array(clip) }) })),
    video_prompt: node('video_prompt', 'text', object({ video_prompt: object({ items: array(prompt) }) })),
    video_render: node('video_render', 'media', object({ videos: array(video) })),
    // 外层功能名与节点内 id 分别遵循 a_drama_detail.json 和 editing.json。
    video_editing: node('editing', 'program', object({ editing: object({ preview_ref: optionalFile, timelines: array(timeline) }) })),
    // delivery.json 缺失：交付产物暂沿用现有 episodes / delivery 契约。
    video_delivery: node('delivery', 'program', object({ episodes: array(episode), delivery })),
  }),
});

export function createDramaModel({ id: projectId, title, aspect_ratio = '9:16', origin_script = '' }) {
  const dimensions = { '21:9': [2520, 1080], '16:9': [1920, 1080], '4:3': [1440, 1080], '1:1': [1080, 1080], '3:4': [1080, 1440], '9:16': [1080, 1920] };
  const [width, height] = dimensions[aspect_ratio] || dimensions['9:16'];
  const products = {
    adaptation_plan: { audience: '', style: '', story_direction: { main_plot: '', must_preserve: [], constraints: [] }, character_plans: [], group_plans: [], scene_plans: [] },
    story_segments: [],
    asset_preparation: { characters: [], props: [], scenes: [], clothes: [] },
    shot_design: [], clip_arrangement: { clip_arrangement: { clips: [] } },
    video_prompt: { video_prompt: { items: [] } }, video_render: { videos: [] },
    video_editing: { editing: { preview_ref: null, timelines: [] } },
    video_delivery: { episodes: [], delivery: { settings: { width, height, fps: 24, subtitle_mode: 'sidecar', normalize_audio: true }, exports: [] } },
  };
  const data = Object.fromEntries(Object.entries(dramaModelSchema.properties.data.properties).map(([key, schema]) => {
    const properties = schema.properties.state.properties;
    return [key, {
      id: schema.properties.id.const, type: schema.properties.type.const, data: products[key],
      state: { status: 'empty', ...(properties.product_revision ? { product_revision: 0 } : {}), opinion: '', reason: '',
        ...(properties.rules ? { rules: { generate: '', review: '', revise: '' } } : {}),
        ...(properties.checkpoint ? { checkpoint: null } : {}),
      },
    }];
  }));
  return assertDramaModel({ id: projectId, title, aspect_ratio, origin_script, data });
}

function fail(path, message) {
  throw Object.assign(new TypeError(`${path}：${message}`), { code: 'INVALID_PROJECT_DOCUMENT', path });
}

export function assertDramaModel(model) {
  validateDocumentSchema(dramaModelSchema, model);
  const product = (key) => model.data[key].data;
  const unique = (rows, path, key = 'id') => {
    const map = new Map();
    for (const row of rows) {
      if (map.has(row[key])) fail(path, `${key}重复：${row[key]}`);
      map.set(row[key], row);
    }
    return map;
  };
  const requireRef = (map, value, path) => {
    if (!map.has(value)) fail(path, `引用不存在：${value}`);
    return map.get(value);
  };
  const segments = unique(product('story_segments'), 'data.story_segments');
  const assets = product('asset_preparation');
  unique(Object.values(assets).flat(), 'data.asset_preparation');
  const core = Object.fromEntries(Object.entries(assets).map(([kind, rows]) => [kind, unique(rows, `data.asset_preparation.${kind}`)]));
  const shots = unique(product('shot_design'), 'data.shot_design');
  unique([...shots.values()], 'data.shot_design.sequence', 'sequence');
  const beats = new Map(), dialogues = new Map();
  for (const shot of shots.values()) {
    const path = `data.shot_design.${shot.id}`;
    requireRef(segments, shot.story_segment_id, `${path}.story_segment_id`);
    for (const [kind, rows] of Object.entries({ characters: shot.characters, clothes: shot.clothes, props: shot.props, scenes: [shot.scene] })) {
      unique(rows.filter(row => row.id !== null), `${path}.${kind}`);
      unique(rows, `${path}.${kind}.name`, 'name');
      for (const row of rows) if (row.id !== null) {
        const original = requireRef(core[kind], row.id, `${path}.${kind}.id`);
        if (original.name !== row.name) fail(`${path}.${kind}.name`, '核心资产名称不一致');
      }
    }
    for (const beat of shot.beats) {
      if (beats.has(beat.id)) fail(`${path}.beats`, '节拍ID重复');
      beats.set(beat.id, { shot, beat });
      if (beat.duration_seconds <= 0) fail(`${path}.beats.duration_seconds`, '时长必须大于0');
      for (const line of beat.dialogues) {
        if (dialogues.has(line.id)) fail(`${path}.dialogues`, '对白ID重复');
        dialogues.set(line.id, line);
        if (line.speaker_id !== null) {
          const speaker = shot.characters.find(row => row.id === line.speaker_id) || core.characters.get(line.speaker_id);
          if (!speaker) fail(`${path}.dialogues.speaker_id`, '说话人引用不存在');
          if (speaker.name !== line.speaker_name) fail(`${path}.dialogues.speaker_name`, '说话人名称与引用不一致');
        }
        if (line.kind === 'dialogue' && !shot.characters.some(row => row.name === line.speaker_name)) fail(`${path}.dialogues.speaker_name`, '现场对白说话人必须出镜');
      }
    }
  }
  const clips = unique(product('clip_arrangement').clip_arrangement.clips, 'data.clip_arrangement.clips');
  unique([...clips.values()], 'data.clip_arrangement.sequence', 'sequence');
  const checkReferences = (value, path) => {
    if (value.reference_images.length > 9 || value.voice_references.length > 3) fail(path, '参考素材数量超限');
    if (value.mode !== 'reference' && (value.reference_images.length || value.voice_references.length)) fail(path, '当前模式不支持参考图/音频');
    unique(value.reference_images, `${path}.reference_images`, 'image_id');
    unique(value.voice_references, `${path}.voice_references`, 'character_id');
    for (const voice of value.voice_references) requireRef(core.characters, voice.character_id, `${path}.voice_references`);
  };
  for (const clip of clips.values()) {
    const path = `data.clip_arrangement.${clip.id}`;
    if (clip.duration_seconds > 15) fail(`${path}.duration_seconds`, '分片时长必须为4至15秒');
    if (clip.mode === 'first_frame' ? !clip.first_image_id : clip.first_image_id || clip.last_image_id) fail(path, '生成模式与首尾帧不匹配');
    if (clip.mode !== 'reference' && clip.reference_images.length) fail(path, '当前模式不支持参考图');
    if (clip.mode === 'reference' && !clip.reference_images.length) fail(path, '参考图模式需要实际参考图片');
    if (clip.reference_images.length > 9) fail(path, '参考图片数量超限');
    if (!clip.sources.length) fail(`${path}.sources`, '分片必须包含来源镜头');
    unique(clip.sources, `${path}.sources`, 'shot_id');
    unique(clip.reference_images, `${path}.reference_images`, 'image_id');
    for (const source of clip.sources) {
      requireRef(shots, source.shot_id, `${path}.sources.shot_id`);
      if (!source.beat_ids.length || new Set(source.beat_ids).size !== source.beat_ids.length) fail(`${path}.sources.beat_ids`, '来源节拍不能为空或重复');
      for (const beatId of source.beat_ids) if (beats.get(beatId)?.shot.id !== source.shot_id) fail(`${path}.sources.beat_ids`, '节拍不属于指定镜头');
    }
    for (const image of clip.reference_images) {
      if (!image.shot_ids.length || new Set(image.shot_ids).size !== image.shot_ids.length) fail(`${path}.reference_images.shot_ids`, '参考图片来源镜头不能为空或重复');
      for (const shotId of image.shot_ids) if (!clip.sources.some(row => row.shot_id === shotId)) fail(`${path}.reference_images.shot_ids`, '参考图片必须属于分片来源镜头');
    }
  }
  const prompts = unique(product('video_prompt').video_prompt.items, 'data.video_prompt');
  for (const prompt of prompts.values()) {
    const path = `data.video_prompt.${prompt.id}`;
    const clip = requireRef(clips, prompt.clip_id, `${path}.clip_id`);
    if (clip.mode !== prompt.mode) fail(`${path}.mode`, '提示词模式与分片不一致');
    checkReferences(prompt, path);
  }
  const videos = unique(product('video_render').videos, 'data.video_render');
  for (const video of videos.values()) {
    const path = `data.video_render.${video.id}`;
    requireRef(clips, video.clip_id, `${path}.clip_id`);
    const prompt = requireRef(prompts, video.prompt_id, `${path}.prompt_id`);
    if (prompt.clip_id !== video.clip_id || prompt.mode !== video.mode) fail(path, '视频提示词归属或模式不一致');
    if (video.duration_seconds <= 0) fail(`${path}.duration_seconds`, '实际媒体时长必须大于0');
    checkReferences({ ...video, reference_images: video.reference_image_ids.map(image_id => ({ image_id })) }, path);
  }
  const timelines = unique(product('video_editing').editing.timelines, 'data.video_editing');
  const timelineEnds = new Map();
  for (const timeline of timelines.values()) {
    const path = `data.video_editing.${timeline.id}`;
    const edits = unique(timeline.clips, `${path}.clips`);
    let end = 0;
    for (const edit of [...edits.values()].sort((a, b) => a.position_seconds - b.position_seconds)) {
      const take = requireRef(videos, edit.take_id, `${path}.take_id`);
      if (edit.out_seconds <= edit.in_seconds || edit.out_seconds > take.duration_seconds) fail(path, '裁切范围超出实际媒体时长');
      if (edit.position_seconds < end - 0.001) fail(path, '时间线片段不能重叠');
      end = edit.position_seconds + edit.out_seconds - edit.in_seconds;
    }
    timelineEnds.set(timeline.id, end);
    for (const transition of timeline.transitions) {
      requireRef(edits, transition.clip_id, `${path}.transitions.clip_id`);
      if (transition.duration_seconds <= 0) fail(`${path}.transitions`, '转场时长必须大于0');
    }
  }
  const { episodes, delivery } = product('video_delivery');
  unique(episodes, 'data.video_delivery.episodes');
  unique(delivery.exports, 'data.video_delivery.exports');
  for (const episode of episodes) {
    requireRef(timelines, episode.timeline_id, 'data.video_delivery.episodes.timeline_id');
    if (episode.end_seconds <= episode.start_seconds || episode.end_seconds > timelineEnds.get(episode.timeline_id) + 0.05) fail('data.video_delivery.episodes', '分集范围无效');
  }
  const { width, height, fps } = delivery.settings;
  if (width > 4096 || height > 4096 || width % 2 || height % 2 || fps > 60) fail('data.video_delivery.delivery.settings', '宽高需为16至4096偶数，帧率1至60');
  // 导出及历史视频引用不可变输入快照，不强制其历史版本等于当前编辑版本。
  // 真实图片/音频/文件存在性由后续存储接入层核实。
  return structuredClone(model);
}
