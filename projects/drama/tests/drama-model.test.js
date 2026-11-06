import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDramaModel, assertDramaModel, dramaModelSchema, createProjectDocument } from '../src/index.js';

const empty = (options = {}) => createDramaModel({ id: 'drama_1', title: '新短剧', ...options });
const asset = (id, name) => ({ id, name, description: '固定外观', image_id: null });
function populated(mode = 'reference') {
  const model = empty({ origin_script: '原稿\n原文' });
  const data = model.data;
  data.story_segments.data.push({ id: 'segment_1', title: '开场', body: 'story/segment_1.txt' });
  data.asset_preparation.data.characters.push(asset('hero', '主角'));
  data.shot_design.data.push({
    id: 'shot_1', sequence: 1, story_segment_id: 'segment_1', visual_description: '院门前的双人构图',
    characters: [asset('hero', '主角'), asset(null, '守卫甲')], clothes: [asset(null, '布衣')], props: [], scene: asset(null, '院门'),
    beats: [{ id: 'beat_1', duration_seconds: 5, action: '主角穿布衣走到门前；守卫甲开门，二人停在门旁。', camera: '固定中景', audio: '开门声', dialogues: [
      { id: 'line_1', kind: 'dialogue', speaker_id: null, speaker_name: '守卫甲', text: '请进。', delivery: '低声' },
      { id: 'line_2', kind: 'narration', speaker_id: null, speaker_name: '叙述者', text: '故事开始了。', delivery: '' },
    ] }],
  });
  const references = mode === 'reference' ? [{ image_id: 'image_1', role: '院门环境', shot_ids: ['shot_1'] }] : [];
  data.clip_arrangement.data.clip_arrangement.clips.push({ id: 'clip_1', sequence: 1, duration_seconds: 5, sources: [{ shot_id: 'shot_1', beat_ids: ['beat_1'] }], mode, first_image_id: mode === 'first_frame' ? 'first_1' : null, last_image_id: null, reference_images: references });
  const voice_references = mode === 'reference' ? [{ character_id: 'hero', voice_revision: 1, audio_ref: 'audio/hero.wav' }] : [];
  data.video_prompt.data.video_prompt.items.push({ id: 'prompt_1', clip_id: 'clip_1', mode, revision: 1, prompt_ref: 'prompts/clip_1.txt', reference_images: references.map(({ image_id, role }) => ({ image_id, role })), voice_references });
  data.video_render.data.videos.push({ id: 'take_1', clip_id: 'clip_1', mode, prompt_id: 'prompt_1', prompt_revision: 1, file_ref: 'videos/clip_1.mp4', duration_seconds: 5, input_snapshot_ref: 'snapshots/input.json', reference_image_ids: references.map(row => row.image_id), voice_references, status: 'approved' });
  data.video_editing.data.editing.timelines.push({ id: 'timeline_1', name: '正片', revision: 1, clips: [{ id: 'edit_1', take_id: 'take_1', in_seconds: 0, out_seconds: 5, position_seconds: 0 }], transitions: [{ clip_id: 'edit_1', duration_seconds: 0.2 }], subtitles_ref: null, audio_tracks_ref: null });
  data.video_delivery.data.episodes.push({ id: 'episode_1', title: '第一集', timeline_id: 'timeline_1', start_seconds: 0, end_seconds: 5 });
  data.video_delivery.data.delivery.exports.push({ id: 'export_1', timeline_id: 'timeline_1', episode_id: 'episode_1', input_snapshot_ref: 'snapshots/export.json', file_ref: 'exports/episode_1.mp4', subtitles_ref: null, validation_report_ref: null });
  return model;
}

test('新模型顶层、九节点顺序及所有已提供草案字段严格对齐', async () => {
  const load = async name => JSON.parse(await readFile(new URL(`../docs/data/${name}`, import.meta.url), 'utf8'));
  const detail = await load('a_drama_detail.json');
  const model = empty();
  assert.deepEqual(Object.keys(model), Object.keys(detail));
  assert.deepEqual(Object.keys(model.data), Object.keys(detail.data));
  function compare(description, schema, path) {
    if (typeof description === 'string' || description?.$ref) return;
    if (Array.isArray(description)) { assert.equal(schema.type, 'array', path); compare(description[0], schema.items, `${path}[]`); return; }
    assert.equal(schema.type, 'object', path);
    assert.deepEqual(Object.keys(schema.properties), Object.keys(description), path);
    assert.deepEqual(schema.required, Object.keys(description), path);
    assert.equal(schema.additionalProperties, false);
    for (const key of Object.keys(description)) compare(description[key], schema.properties[key], `${path}.${key}`);
  }
  for (const [key, ref] of Object.entries(detail.data)) {
    if (key === 'video_delivery') continue; // 草案未提供 delivery.json。
    compare(await load(ref.$ref), dramaModelSchema.properties.data.properties[key], key);
  }
  assert.equal(model.data.video_editing.id, 'editing');
  assert.equal(model.data.video_delivery.id, 'delivery');
  for (const node of Object.values(model.data)) {
    assert.equal(node.state.status, 'empty');
    assert.equal(node.state.product_revision, node.id === 'adaptation_plan' ? undefined : 0);
    assert.equal(Object.hasOwn(node.state, 'rules'), node.type === 'ai');
  }
});

test('初始化保持原稿，画幅尺寸正确且实例之间互不污染', () => {
  const model = empty({ origin_script: '  原稿\r\n内容  ', aspect_ratio: '16:9' });
  assert.equal(model.origin_script, '  原稿\r\n内容  ');
  assert.equal(model.data.video_delivery.data.delivery.settings.width, 1920);
  assert.equal(model.data.video_delivery.data.delivery.settings.height, 1080);
  model.data.adaptation_plan.state.rules.generate = '本项目规则';
  assert.equal(empty().data.adaptation_plan.state.rules.generate, '');
  assert.throws(() => empty({ aspect_ratio: '2:1' }), { code: 'INVALID_PROJECT_DOCUMENT' });
  assert.throws(() => empty({ title: ' ' }), { code: 'INVALID_PROJECT_DOCUMENT' });
});

test('完整新模型支持缺图核心资产、临时资产、非核心说话人与三种生成模式，返回独立副本', () => {
  for (const mode of ['text', 'reference', 'first_frame']) {
    const model = populated(mode), snapshot = structuredClone(model), result = assertDramaModel(model);
    assert.deepEqual(result, snapshot);
    result.data.story_segments.data[0].title = '改标题';
    assert.deepEqual(model, snapshot);
  }
  assert.equal(createProjectDocument({ id: 'old', name: '现有项目' }).schema_version, 4);
});

test('严格拒绝旧字段、错误节点标识及类型，错误携带路径', () => {
  const mutations = [
    m => { m.basic_info = {}; },
    m => { m.data.asset_preparation.data.clothing = []; },
    m => { m.data.shot_design.data[0].ending_state = '旧字段'; },
    m => { m.data.story_segments.data[0].sequence = 1; },
    m => { m.data.video_editing.id = 'video_editing'; },
    m => { m.data.video_render.type = 'program'; },
    m => { m.data.clip_arrangement.state.rules = {}; },
    m => { m.data.asset_preparation.state.checkpoint = null; },
    m => { m.data.shot_design.data[0].beats[0].dialogues[0].delivery = {}; },
  ];
  for (const mutate of mutations) {
    const model = populated(); mutate(model);
    assert.throws(() => assertDramaModel(model), error => error.code === 'INVALID_PROJECT_DOCUMENT' && error.path.startsWith('project'));
  }
});

test('内部引用、唯一标识和素材类型严格校验，允许多个无id临时人物', () => {
  const valid = populated(); valid.data.shot_design.data[0].characters.push(asset(null, '守卫乙'));
  assertDramaModel(valid);
  const mutations = [
    m => { m.data.story_segments.data.push({ ...m.data.story_segments.data[0] }); },
    m => { m.data.asset_preparation.data.props.push(asset('hero', '冲突道具')); },
    m => { m.data.shot_design.data[0].story_segment_id = 'missing'; },
    m => { m.data.shot_design.data[0].scene.id = 'hero'; },
    m => { m.data.shot_design.data[0].characters[0].name = '错误名字'; },
    m => { m.data.shot_design.data[0].characters[1].id = 'missing'; },
    m => { m.data.shot_design.data[0].beats[0].dialogues[0].speaker_id = 'missing'; },
    m => { m.data.shot_design.data[0].beats[0].dialogues[0].speaker_name = '未出镜人物'; },
    m => { m.data.shot_design.data[0].beats.push({ ...m.data.shot_design.data[0].beats[0] }); },
    m => { m.data.shot_design.data[0].beats[0].dialogues.push({ ...m.data.shot_design.data[0].beats[0].dialogues[0] }); },
    m => { m.data.clip_arrangement.data.clip_arrangement.clips[0].sources[0].beat_ids = ['missing']; },
    m => { m.data.clip_arrangement.data.clip_arrangement.clips[0].reference_images[0].shot_ids = ['missing']; },
    m => { m.data.video_prompt.data.video_prompt.items[0].clip_id = 'missing'; },
    m => { m.data.video_prompt.data.video_prompt.items[0].voice_references[0].character_id = 'missing'; },
    m => { m.data.video_render.data.videos[0].prompt_id = 'missing'; },
    m => { m.data.video_editing.data.editing.timelines[0].clips[0].take_id = 'missing'; },
    m => { m.data.video_delivery.data.episodes[0].timeline_id = 'missing'; },
  ];
  for (const mutate of mutations) {
    const model = populated(); mutate(model);
    assert.throws(() => assertDramaModel(model), { code: 'INVALID_PROJECT_DOCUMENT' });
  }
});

test('生成模式、时间、资源上限和后期边界不能绕过', () => {
  const mutations = [
    m => { m.data.clip_arrangement.data.clip_arrangement.clips[0].duration_seconds = 16; },
    m => { m.data.clip_arrangement.data.clip_arrangement.clips[0].duration_seconds = 3; },
    m => { m.data.clip_arrangement.data.clip_arrangement.clips[0].first_image_id = 'first'; },
    m => { m.data.clip_arrangement.data.clip_arrangement.clips[0].reference_images = []; },
    m => { m.data.clip_arrangement.data.clip_arrangement.clips[0].sources = []; },
    m => { m.data.video_prompt.data.video_prompt.items[0].mode = 'text'; },
    m => { m.data.shot_design.data[0].beats[0].duration_seconds = 0; },
    m => { m.data.video_render.data.videos[0].duration_seconds = 0; },
    m => { m.data.video_prompt.data.video_prompt.items[0].reference_images = Array.from({ length: 10 }, (_, i) => ({ image_id: `image_${i}`, role: '场景' })); },
    m => { m.data.video_editing.data.editing.timelines[0].clips[0].out_seconds = 6; },
    m => { m.data.video_editing.data.editing.timelines[0].clips.push({ id: 'edit_2', take_id: 'take_1', in_seconds: 0, out_seconds: 5, position_seconds: 4 }); },
    m => { m.data.video_editing.data.editing.timelines[0].transitions[0].clip_id = 'missing'; },
    m => { m.data.video_delivery.data.episodes[0].end_seconds = 6; },
    m => { m.data.video_delivery.data.delivery.settings.width = 4098; },
    m => { m.data.video_delivery.data.delivery.settings.fps = 61; },
  ];
  for (const mutate of mutations) {
    const model = populated(); mutate(model);
    assert.throws(() => assertDramaModel(model), { code: 'INVALID_PROJECT_DOCUMENT' });
  }
});
