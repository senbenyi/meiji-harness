import { emptyCharacterModel } from "../shared/models/character_model.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  dependencyHash,
  expireDownstream,
  isNodeCurrent,
  shotCharacterContext,
  stampDependencyHash,
} from "../shared/node-dependencies.js";
import { enqueueNode, restoreQueued } from "../shared/node-state.js";
import { nodeOf, createId } from "../shared/task_contract.js";
import { snapshotFixture, taskFixture } from "./fixtures/project.js";
import { replaceShots } from "../shared/collection-identity.js";
import { commitContent } from "../server/handlers/content.js";
import { emptyCostumeModel } from "../shared/models/costume_model.js";
for (const [business, expected] of [
  [
    "episode-plot",
    [
      "episode-summary",
      "outline",
      "shots",
      "seconds",
      "storyboard",
      "video",
      "tail",
      "assembly",
    ],
  ],
  [
    "outline",
    [
      "shots",
      "seconds",
      "storyboard",
      "video",
      "tail",
      "assembly",
    ],
  ],
  ["shots", ["seconds", "storyboard", "video"]],
  ["seconds", ["storyboard", "video", "tail", "assembly"]],
  ["storyboard", ["video", "tail", "assembly"]],
  ["video", ["tail", "assembly"]],
  ["tail", ["video"]],
])
  test(`S3-04/05 ${business} 逐级过期且内容保留`, () => {
    const snapshot = snapshotFixture(),
      p = snapshot.project,
      e = p.episodes[0],
      s = e.shot_list.shots[0],
      id = ["episode-plot", "outline", "shots"].includes(
        business,
      )
        ? e.id
        : s.id;
    const result = expireDownstream(snapshot, business, id, "上游已修改", { compareHash: false });
    for (const type of expected)
      assert.ok(
        result.some((key) => key.startsWith(`${type}:`)),
        type,
      );
    assert.equal(e.shot_list.shots[1].video.node_state.status, "expired");
    assert.equal(s.video.address, "1.mp4");
  });
test("S3-03 排队快照随上游失效，取消后恢复 expired", () => {
  const snapshot = snapshotFixture(),
    p = snapshot.project,
    t = taskFixture(p, "video"),
    s = p.episodes[0].shot_list.shots[0];
  enqueueNode(p, t);
  snapshot.tasks = [t];
  assert.equal(s.video.node_state.status, "generated");
  expireDownstream(snapshot, "seconds", s.id, "上游已修改", { compareHash: false });
  assert.equal(s.video.node_state.status, "expired");
  assert.equal(t.previous_node_state.status, "expired");
  restoreQueued(p, t);
  assert.equal(s.video.node_state.status, "expired");
});
test("S3-04 剧本更新使依赖剧本的节点过期，配置变化不触发过期；非 generated 保持状态", () => {
  const snapshot = snapshotFixture(),
    p = snapshot.project,
    s = p.episodes[0].shot_list.shots[0];
  s.text_to_video_prompt.node_state.status = "rejected";
  s.text_to_video_prompt.node_state.reason = "未通过";
  stampGenerated(snapshot);
  p.script.body = "修改后的剧本";
  expireDownstream(snapshot, "script", p.id);
  assert.equal(p.project_summary.node_state.status, "expired");
  assert.equal(p.episodes[0].story_outline.node_state.status, "generated");
  p.aspect_ratio = "768x1344";
  assert.equal(s.video.node_state.status, "generated");
  expireDownstream(snapshot, "seconds", s.id, "上游已修改", { compareHash: false });
  assert.equal(s.text_to_video_prompt.node_state.status, "rejected");
  assert.equal(s.text_to_video_prompt.node_state.reason, "未通过");
});
test("S3-05 图片变化只使实际使用该参考图的视频过期（基于确认绑定）", () => {
  const snapshot = snapshotFixture(),
    p = snapshot.project,
    s = p.episodes[0].shot_list.shots[0];
  const id = createId("character");
  p.character_library.characters = [
    emptyCharacterModel({
      id,
      number: "C01",
      costume_images: [{ costume_id: "", ...{ node_state: { status: "generated", reason: "", dependency_hash: "" }, address: "c.png" } }],
      costumes: [],
    }),
  ];
  s.character_binding.on_screen_characters = [{ character_id: id, costume_id: "" }];
  const t = taskFixture(p, "video", s.id, { task_status: "completed" });
  snapshot.tasks = [t];
  snapshot.steps = [
    { task_id: t.id, result: { address: s.video.address, reference_ids: [id] } },
  ];
  expireDownstream(snapshot, "character-image", id);
  assert.equal(s.video.node_state.status, "expired");
});

function stampGenerated(snapshot) {
  const project = snapshot.project,
    episode = project.episodes[0];
  stampDependencyHash(snapshot, "project-summary", project.id);
  for (const business of ["episode-summary", "outline", "shots"])
    stampDependencyHash(snapshot, business, episode.id);
  for (const shot of episode.shot_list.shots)
    for (const business of ["seconds", "storyboard", "video", "tail"])
      stampDependencyHash(snapshot, business, shot.id);
  stampDependencyHash(snapshot, "assembly", episode.id);
}
test("已记录指纹且资料未变时不标过期", () => {
  const snapshot = snapshotFixture(),
    episode = snapshot.project.episodes[0];
  stampGenerated(snapshot);
  expireDownstream(snapshot, "outline", episode.id);
  assert.equal(episode.shot_list.node_state.status, "generated");
  assert.equal(episode.shot_list.shots[0].seconds_storyboard.node_state.status, "generated");
  assert.equal(episode.shot_list.shots[1].video.node_state.status, "generated");
});
test("大纲正文变化使镜头表和下游过期，镜头正文保留", () => {
  const snapshot = snapshotFixture(),
    episode = snapshot.project.episodes[0];
  stampGenerated(snapshot);
  episode.story_outline.segments[0].body = "改过的故事";
  expireDownstream(snapshot, "outline", episode.id);
  assert.equal(episode.shot_list.node_state.status, "expired");
  assert.equal(episode.shot_list.shots[0].seconds_storyboard.node_state.status, "expired");
  assert.equal(episode.shot_list.shots[0].video.address, "1.mp4");
  assert.equal(episode.shot_list.shots[1].video.node_state.status, "expired");
  assert.equal(episode.shot_list.shots[0].body, "剧情");
});
test("剧情变化即使大纲小段未改，镜头表也过期", () => {
  const snapshot = snapshotFixture(),
    episode = snapshot.project.episodes[0];
  stampGenerated(snapshot);
  episode.plot = "新剧情";
  expireDownstream(snapshot, "episode-plot", episode.id, "剧情已修改");
  assert.equal(episode.summary.node_state.status, "expired");
  assert.equal(episode.story_outline.node_state.status, "expired");
  assert.equal(episode.shot_list.node_state.status, "expired");
  assert.equal(episode.story_outline.segments[0].body, "故事");
});
test("声音不改变角色图片指纹，不可改特征变化使图片和引用视频过期", () => {
  const snapshot = snapshotFixture(),
    project = snapshot.project,
    shot = project.episodes[0].shot_list.shots[0],
    id = createId("character");
  project.character_library.characters = [
    emptyCharacterModel({
      id,
      number: "C01",
      name: "甲",
      nationality: "",
      position: "",
      immutable_traits: [],
      gender: "",
      era: "",
      age_range: "",
      height: "",
      body_type: "",
      facial_features: "",
      voice: "低",
      required_appearance: false,
      default_costume_id: "",
      costume_images: [{ costume_id: "", ...{ node_state: { status: "generated", reason: "", dependency_hash: "" }, address: "c.png" } }],
      reference_image: { address: "" },
      costumes: [],
    }),
  ];
  const task = taskFixture(project, "video", shot.id, { task_status: "completed" });
  snapshot.tasks = [task];
  snapshot.steps = [
    { task_id: task.id, result: { address: shot.video.address, reference_ids: [id] } },
  ];
  stampDependencyHash(snapshot, "character-image", id);
  stampDependencyHash(snapshot, "video", shot.id);
  const image = project.character_library.characters[0];
  image.voice = "高";
  assert.equal(dependencyHash(snapshot, "character-image", id), image.costume_images[0].node_state.dependency_hash);
  expireDownstream(snapshot, "character-setting", id, "固定资料已修改");
  assert.equal(image.costume_images[0].node_state.status, "generated");
  image.immutable_traits = ["圆脸"];
  expireDownstream(snapshot, "character-setting", id, "固定资料已修改");
  assert.equal(image.costume_images[0].node_state.status, "expired");
  assert.equal(shot.video.node_state.status, "expired");
  assert.equal(shot.video.address, "1.mp4");
});
test("剧情同步更新只使展示摘要过期，不使故事大纲过期", () => {
  const snapshot = snapshotFixture(),
    e = snapshot.project.episodes[0];
  e.plot = "同步后的剧情";
  expireDownstream(snapshot, "episode-plot-sync", e.id, "剧情已更新");
  assert.equal(e.summary.node_state.status, "expired");
  assert.equal(e.story_outline.node_state.status, "generated");
});

test("首套服装变化使后续定妆照过期，次套变化不影响首套", () => {
  const snapshot = snapshotFixture(), character = emptyCharacterModel({ name: "甲", body_type: "强壮", position: "主角", age_range: "青年", reference_image: { address: "reference.png" } });
  character.costume_images[0].address = "character.png";
  character.costume_images[0].node_state.status = "generated";
  character.costumes = ["常服", "夜行服"].map((name, index) => ({ id: createId("costume"), number: `C01-0${index+1}`, name, color: "黑", material: "布", props: [], description: "" }));
  character.costume_images = character.costumes.map(costume => ({ costume_id: costume.id, address: `${costume.id}.png`, node_state: { status: "generated", reason: "", dependency_hash: "" } }));
  snapshot.project.character_library.characters = [character];
  stampDependencyHash(snapshot, "character-image", character.id);
  for (const costume of character.costumes) stampDependencyHash(snapshot, "costume-image", costume.id);
  const before = character.costume_images[0].node_state.dependency_hash;
  character.reference_image.address = "other.png";
  assert.notEqual(dependencyHash(snapshot, "character-image", character.id), before);
  character.reference_image.address = "reference.png";
  character.costumes[1].color = "白";
  expireDownstream(snapshot, "costume-setting", character.costumes[1].id);
  assert.equal(character.costume_images[0].node_state.status, "generated");
  assert.equal(character.costume_images[1].node_state.status, "expired");
  character.costume_images[1].node_state.status = "generated";
  stampDependencyHash(snapshot, "costume-image", character.costumes[1].id);
  character.costumes[0].color = "白";
  expireDownstream(snapshot, "costume-setting", character.costumes[0].id);
  assert.equal(character.costume_images[0].node_state.status, "expired");
  assert.equal(character.costume_images[1].node_state.status, "expired");
});

test("空服装定妆照依赖角色资料和角色图，角色资料变更保留图片并使其过期", () => {
  const snapshot = snapshotFixture(), character = emptyCharacterModel({ name: "乙", body_type: "瘦削", position: "配角" });
  character.costume_images[0] = { address: "character.png", node_state: { status: "generated", reason: "", dependency_hash: "" } };
  character.costume_images = [{ costume_id: "", address: "portrait.png", node_state: { status: "generated", reason: "", dependency_hash: "" } }];
  snapshot.project.character_library.characters = [character];
  stampDependencyHash(snapshot, "character-image", character.id);
  stampDependencyHash(snapshot, "costume-image", character.id);
  character.age_range = "老年";
  expireDownstream(snapshot, "character-setting", character.id);
  assert.equal(character.costume_images[0].node_state.status, "expired");
  assert.equal(character.costume_images[0].node_state.status, "expired");
  assert.equal(character.costume_images[0].address, "portrait.png");
  assert.deepEqual(character.costumes, []);
});

test("节点有效性要求结构和非空保存hash匹配，不吞掉程序错误", () => {
  const snapshot = snapshotFixture(), e = snapshot.project.episodes[0];
  stampGenerated(snapshot);
  assert.equal(isNodeCurrent(snapshot, "outline", e.id), true);
  e.duration_seconds += 1;
  assert.equal(isNodeCurrent(snapshot, "outline", e.id), false);
  e.duration_seconds -= 1;
  e.story_outline.node_state.dependency_hash = "";
  assert.equal(isNodeCurrent(snapshot, "outline", e.id), false);
  assert.equal(isNodeCurrent(snapshot, "outline", createId("episode")), false);
  Object.defineProperty(e.story_outline, "node_state", { get() { throw new Error("读取损坏"); } });
  assert.throws(() => isNodeCurrent(snapshot, "outline", e.id), /读取损坏/);
});

test("修改剧集参考时长使大纲、镜头及排队快照过期，摘要保持有效", () => {
  const snapshot = snapshotFixture(), e = snapshot.project.episodes[0], s = e.shot_list.shots[0];
  stampGenerated(snapshot);
  const oldHash = e.story_outline.node_state.dependency_hash;
  const queued = taskFixture(snapshot.project, "video", s.id);
  snapshot.tasks.push(queued);
  enqueueNode(snapshot.project, queued);
  e.duration_seconds += 5;
  expireDownstream(snapshot, "episode-duration", e.id, "参考时长已修改");
  assert.equal(e.summary.node_state.status, "generated");
  assert.equal(e.story_outline.node_state.status, "expired");
  assert.equal(e.story_outline.node_state.dependency_hash, oldHash);
  assert.equal(e.shot_list.node_state.status, "expired");
  assert.equal(s.video.node_state.status, "expired");
  assert.deepEqual(queued.previous_node_state, { status: "expired", reason: "参考时长已修改", fail_message: "" });
  assert.equal(e.assembly.node_state.status, "expired");
});

test("大纲causal和上游保存hash各自参与镜头表依赖", () => {
  for (const edit of [
    e => { e.story_outline.segments[0].causal = "雨停后离开"; },
    e => { e.story_outline.node_state.dependency_hash = "a".repeat(64); },
  ]) {
    const snapshot = snapshotFixture(), e = snapshot.project.episodes[0];
    stampGenerated(snapshot);
    edit(e);
    expireDownstream(snapshot, "outline", e.id);
    assert.equal(e.shot_list.node_state.status, "expired");
    assert.equal(e.shot_list.shots[0].seconds_storyboard.node_state.status, "expired");
  }
});

for (const [field, value] of [
  ["title", "新标题"], ["number", "S99"], ["duration_seconds", 6],
  ["shot_scale", "特写"], ["hook", "悬念"], ["body", "新的动作"],
  ["continuity_transition", "直接切换"],
  ["reference_anchor", { fixed_landmark: "门", character_positions: "门外", departed_characters: "甲已离场", lighting: "晨光" }],
  ["audio_arrangement", { narration: "天亮", dialogue: "出发", sound_effects: "脚步" }],
]) test(`镜头${field}变化影响每秒分镜与下游`, () => {
  const snapshot = snapshotFixture(), e = snapshot.project.episodes[0], shot = e.shot_list.shots[0];
  stampGenerated(snapshot);
  shot[field] = value;
  expireDownstream(snapshot, "shots", e.id);
  assert.equal(shot.seconds_storyboard.node_state.status, "expired");
  assert.equal(shot.video.node_state.status, "expired");
  assert.equal(e.assembly.node_state.status, "expired");
  assert.equal(shot.video.address, "1.mp4");
});

function withCharacter() {
  const snapshot = snapshotFixture();
  snapshot.project.character_library.characters = [emptyCharacterModel({
    number: "C01", name: "甲", body_type: "瘦削", position: "主角",
    costumes: [emptyCostumeModel({ number: "C01-01", name: "常服", color: "黑" })],
  })];
  stampGenerated(snapshot);
  return snapshot;
}

test("角色文字投影与hash排除图片、声音、默认服装，文本变化使镜头过期", () => {
  const snapshot = withCharacter(), p = snapshot.project, e = p.episodes[0], c = p.character_library.characters[0];
  const before = shotCharacterContext(p);
  c.reference_image.address = "reference.png";
  c.costume_images[0].address = "character.png";
  c.costume_images[0].node_state.status = "generated";
  c.voice = "低沉";
  c.default_costume_id = c.costumes[0].id;
  assert.deepEqual(shotCharacterContext(p), before);
  assert.equal(dependencyHash(snapshot, "shots", e.id), e.shot_list.node_state.dependency_hash);
  c.age_range = "青年";
  expireDownstream(snapshot, "character-setting", c.id);
  assert.equal(e.shot_list.node_state.status, "expired");
  assert.equal(e.shot_list.shots[0].video.node_state.status, "expired");
});

test("角色节点仅因剧本变为过期，文字未变化不阻断镜头表", () => {
  const snapshot = withCharacter(), p = snapshot.project;
  p.character_library.node_state.status = "generated";
  stampDependencyHash(snapshot, "project-characters", p.id);
  p.script.body = "新的剧本";
  expireDownstream(snapshot, "script", p.id);
  assert.equal(p.character_library.node_state.status, "expired");
  assert.equal(p.episodes[0].shot_list.node_state.status, "generated");
});

test("服装文本编辑与角色删除都检查镜头表，删除后无需定位旧角色", () => {
  for (const remove of [false, true]) {
    const snapshot = withCharacter(), p = snapshot.project, c = p.character_library.characters[0];
    if (remove) {
      p.character_library.characters = [];
      expireDownstream(snapshot, "project-characters", p.id);
    } else {
      c.costumes[0].color = "红";
      // 资料编辑入口也应检查文字依赖，与是否已生成定妆照无关。
      c.costume_images = [{ costume_id: c.costumes[0].id, address: "", node_state: { status: "empty", reason: "", dependency_hash: "" } }];
      expireDownstream(snapshot, "costume-setting", c.costumes[0].id);
    }
    assert.equal(p.episodes[0].shot_list.node_state.status, "expired");
  }
});

test("rejected大纲候选不传播，相同候选通过后仍按旧下游hash标过期", () => {
  const snapshot = snapshotFixture(), e = snapshot.project.episodes[0];
  stampGenerated(snapshot);
  const task = taskFixture(snapshot.project, "outline", e.id);
  const candidate = { segments: structuredClone(e.story_outline.segments) };
  candidate.segments[0].causal = "听到呼救后前往";
  const oldHash = e.story_outline.node_state.dependency_hash;
  commitContent(snapshot, task, candidate, { passed: false });
  assert.equal(e.story_outline.node_state.dependency_hash, oldHash);
  assert.equal(e.shot_list.node_state.status, "generated");
  commitContent(snapshot, task, candidate, { passed: true });
  expireDownstream(snapshot, "outline", e.id);
  assert.equal(e.shot_list.node_state.status, "expired");
});

test("角色rejected候选不传播，相同文字通过或人工放行后使镜头过期", () => {
  for (const action of ["regenerate", "override"]) {
    const snapshot = withCharacter(), p = snapshot.project, e = p.episodes[0];
    const task = taskFixture(p, "project-characters", p.id, { episode_id: null });
    const candidate = { characters: structuredClone(p.character_library.characters) };
    candidate.characters[0].position = "巡检";
    commitContent(snapshot, task, candidate, { passed: false });
    assert.equal(e.shot_list.node_state.status, "generated");
    task.action = action;
    commitContent(snapshot, task, candidate, { passed: true });
    expireDownstream(snapshot, "project-characters", p.id);
    assert.equal(e.shot_list.node_state.status, "expired");
  }
});

test("删除或重排镜头保留剩余身份并使合片及新的前镜引用过期", () => {
  for (const remove of [false, true]) {
    const snapshot = snapshotFixture(), e = snapshot.project.episodes[0];
    stampGenerated(snapshot);
    const oldSecond = e.shot_list.shots[1], oldVideo = oldSecond.video.address;
    const fields = ["title", "number", "duration_seconds", "shot_scale", "hook", "body", "continuity_transition", "reference_anchor", "audio_arrangement"];
    let rows = e.shot_list.shots.map(shot => Object.fromEntries(fields.map(field => [field, structuredClone(shot[field])])));
    rows = remove ? rows.slice(1) : rows.reverse();
    e.shot_list.shots = replaceShots(snapshot.project, e.id, rows).shots;
    expireDownstream(snapshot, "shots", e.id);
    const retained = e.shot_list.shots.find(shot => shot.id === oldSecond.id);
    assert.equal(retained.seconds_storyboard.node_state.status, "generated");
    assert.equal(retained.video.node_state.status, "expired");
    assert.equal(retained.video.address, oldVideo);
    assert.equal(e.assembly.node_state.status, "expired");
  }
});

test("合片读取视频的保存hash而非递归重算", () => {
  const snapshot = snapshotFixture(), e = snapshot.project.episodes[0];
  stampGenerated(snapshot);
  e.shot_list.shots[0].video.node_state.dependency_hash = "b".repeat(64);
  expireDownstream(snapshot, "video", e.shot_list.shots[0].id);
  assert.equal(e.assembly.node_state.status, "expired");
});
