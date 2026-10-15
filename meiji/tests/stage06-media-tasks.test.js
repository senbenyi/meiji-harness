import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ModelRepository } from "../server/data/model-repository.js";
import { TaskService } from "../server/flow/tasks/task-manager.js";
import { createTestMediaHandler as createMediaHandler } from "./fixtures/ai.js";
import { commitContent } from "../server/handlers/content.js";
import { MediaStore } from "../server/media/media-store.js";
import { mergeCharacters } from "../shared/collection-identity.js";
import { projectFixture } from "./fixtures/project.js";
import { stampDependencyHash } from "../shared/node-dependencies.js";
export async function mediaBytes(root) {
  const video = join(root, "source.mp4"),
    image = join(root, "source.png");
  for (const args of [
    [
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=32x32:d=4",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      video,
    ],
    ["-i", video, "-frames:v", "1", image],
  ]) {
    const result = spawnSync(
      "ffmpeg",
      ["-y", "-hide_banner", "-loglevel", "error", ...args],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
  }
  return { video: await readFile(video), image: await readFile(image) };
}

test("S6-01/02/03/04 仅姓名角色通过前置，真实媒体经过图片、视频、尾帧与合片执行链", async () => {
  const root = await mkdtemp(join(tmpdir(), "meiji-media-tasks-"));
  try {
    const bytes = await mediaBytes(root),
      p = projectFixture(),
      e = p.episodes[0];
    e.duration_seconds = 5;
    e.story_outline.segments[0].duration_seconds = 5;
    e.shot_list.shots = e.shot_list.shots.slice(0, 1);
    p.character_library.characters = mergeCharacters(p, [
      {
        name: "甲", gender: "未明确", era: "未明确", position: "", age_range: "", body_type: "", hairstyle: "",
        signature_props: [], immutable_traits: [], costumes: [{ name: "常服", color: "白色", material: "棉", props: [] }],
      },
    ]).characters;
    p.character_library.characters[0].voice = "低沉";
    const c = p.character_library.characters[0],
      co = c.costumes[0],
      s = e.shot_list.shots[0];
    s.text_to_video_prompt.overall_soundscape = "Natural ambience.";
    s.text_to_video_prompt.non_diegetic_music = "None.";
    s.character_binding.on_screen_characters = [{ character_id: c.id, costume_id: co.id }];
    const snapshot = { project: p, tasks: [], steps: [] };
    for (const business of ["episode-summary", "outline", "shots"])
      stampDependencyHash(snapshot, business, e.id);
    for (const business of ["shot-characters", "seconds", "storyboard", "video", "tail"])
      stampDependencyHash(snapshot, business, s.id);
    stampDependencyHash(snapshot, "assembly", e.id);
    const repository = new ModelRepository(join(root, "projects")),
      model = await repository.create(p),
      media = new MediaStore(join(root, "media")),
      calls = [];
    const execute = createMediaHandler({
        media,
        gateway: {
          image: async (options) => {
            calls.push(options);
            return bytes.image;
          },
          submitVideo: async () => ({ id: "remote-test" }),
          retrieveVideo: async () => bytes.video,
        },
      }),
      service = new TaskService({
        repository,
        execute,
        commitOutput: commitContent,
      });
    const submit = async (business, id, action) => {
      const result = await service.command({
        type: "submit",
        project_id: p.id,
        request_id: crypto.randomUUID(),
        business_type: business,
        target_id: id,
        action,
      });
      await service.idle(p.id);
      assert.equal(
        model.read().tasks.find((t) => t.id === result.task_id).task_status,
        "completed",
        model.read().tasks.find((t) => t.id === result.task_id).end_reason,
      );
      return result;
    };
    await submit("costume-image", co.id, "generate");
    assert.equal(calls[0].references.length, 0);
    assert.ok(!calls[0].prompt.includes("低沉"));

    const video = await submit("video", s.id, "regenerate");
    assert.equal(
      model
        .read()
        .steps.find(
          (st) => st.task_id === video.task_id && st.kind === "generate",
        ).result.remote_id,
      "remote-test",
    );
    assert.ok(model.read().project.episodes[0].shot_list.shots[0].last_frame.address);
    const info = await media.validate(model.read().project.episodes[0].shot_list.shots[0].video.address, p.id, "video");
    assert.equal(model.read().project.episodes[0].shot_list.shots[0].actual_duration_seconds, Math.round(info.duration * 10) / 10);
    const restored = await new ModelRepository(join(root, "projects")).open(p.id);
    assert.equal(restored.read().project.episodes[0].shot_list.shots[0].actual_duration_seconds, Math.round(info.duration * 10) / 10);
    await submit("assembly", e.id, "regenerate");
    await media.validate(model.read().project.episodes[0].assembly.address, p.id, "video");
    await assert.rejects(
      media.put(p.id, Buffer.from("invalid"), "png"),
      /媒体|Invalid|invalid|Invalid data|ffprobe/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("图片提示词的人物资料组装为一句话，省略编号、必出与缺失值", async () => {
  const { personSentence } = await import("../server/handlers/media-handler.js");
  const { composeNodePrompt } = await import("../server/http/ai-routes.js");
  const sentence = personSentence({
    number: "C6",
    name: "郓哥",
    nationality: "中国",
    position: "水果贩",
    signature_props: [],
    immutable_traits: ["受过武大郎照顾，愿意冒险相助"],
    gender: "男",
    era: "古代（架空）",
    age_range: "18岁",
    height: "资料未提供",
    body_type: "瘦削",
    facial_features: "机灵",
    required_appearance: true,
  });
  assert.equal(
    sentence,
    "郓哥；男；古代（架空）；水果贩；18岁；身材瘦削；不可改特征受过武大郎照顾，愿意冒险相助。",
  );
  const prompt = composeNodePrompt("costume-image", "generate", {
    language: "zh-CN", person: sentence, costume: "", referenceDescription: "", requirements: "", aspectRatio: "16:9", references: [],
  }, "elysium-image");
  assert.match(prompt.user, /## 人物资料\n郓哥；男；古代/);
  assert.doesNotMatch(prompt.user, /### |编号|必出|有图|资料未提供/);
  const { languageName } = await import("../server/prompts/inputs.js");
  assert.equal(languageName("zh-CN"), "简体中文");
  assert.equal(languageName("en"), "English（英文）");
});

test("项目图片请求遵循可选用户参考和定妆照固定角色图，空服装不补写资料", async () => {
  const { emptyCharacterModel } = await import("../shared/models/character_model.js");
  const { emptyCostumeModel } = await import("../shared/models/costume_model.js");
  const { emptyCostumeImageModel } = await import("../shared/models/costume_image_model.js");
  const p = projectFixture();
  const c = emptyCharacterModel({ number: "C01", name: "甲", position: "主角", age_range: "中年", body_type: "健壮", hairstyle: "短发", signature_props: ["纸扇"], immutable_traits: ["左眉疤痕"] });
  const costume = emptyCostumeModel({ number: "C01-01", name: "常服", color: "蓝色", material: "棉", props: ["腰带"] });
  c.costume_images[0].address = "role.png";
  c.costume_images[0].node_state.status = "generated";
  c.costumes = [costume];
  c.costume_images = [emptyCostumeImageModel(costume.id)];
  c.costume_images[0].address = "old-costume.png";
  p.character_library.characters = [c];
  const calls = [], records = [];
  const execute = createMediaHandler({
    gateway: { image: async (args) => { calls.push(args); return Buffer.from("image"); } },
    media: { validate: async () => ({}), read: async (address) => Buffer.from(address), put: async () => ({ address: "new.png" }) },
  });
  const run = (business_type, target_id, opinion = "") => execute({ snapshot: { project: p }, task: { business_type, target_id, action: opinion ? "regenerate" : "generate", opinion }, step: { kind: "generate" }, signal: new AbortController().signal, record: async (record) => records.push(record) });
  await run("costume-image", costume.id);
  assert.equal(calls.at(-1).references.length, 0);
  c.reference_image.address = "user.png";
  await run("costume-image", costume.id, "保留疤痕");
  assert.equal(calls.at(-1).references[0].bytes.toString(), "user.png");
  assert.match(calls.at(-1).prompt, /中年|短发|纸扇|左眉疤痕/);
  const second = emptyCostumeModel({ name: "礼服", color: "蓝色", material: "棉", props: ["腰带"] });
  c.costumes.push(second); c.costume_images.push(emptyCostumeImageModel(second.id));
  await run("costume-image", second.id, "调整姿势");
  assert.equal(calls.at(-1).references.length, 1);
  assert.equal(calls.at(-1).references[0].bytes.toString(), "old-costume.png");
  assert.match(calls.at(-1).prompt, /蓝色，棉，腰带/);
  c.costumes = [];
  c.costume_images = [emptyCostumeImageModel()];
  await run("costume-image", c.id);
  assert.equal(calls.at(-1).references[0].bytes.toString(), "user.png");
  assert.doesNotMatch(calls.at(-1).prompt, /蓝色|棉，腰带/);
  assert.deepEqual(c.costumes, []);
  assert.equal(c.costume_images.length, 1);
  assert.equal(calls.length, 4);
  assert.equal(records.at(-1).prompt.parameters.reference_count, 1);
});

function stampAssemblyInputs(project) {
  const episode = project.episodes[0], snapshot = { project, tasks: [], steps: [] };
  for (const business of ["episode-summary", "outline", "shots"])
    stampDependencyHash(snapshot, business, episode.id);
  for (const shot of [...episode.shot_list.shots].sort((a, b) => a.sequence - b.sequence))
    for (const business of ["shot-characters", "seconds", "storyboard", "video", "tail"])
      stampDependencyHash(snapshot, business, shot.id);
  stampDependencyHash(snapshot, "assembly", episode.id);
}

test("合片按 sequence 顺序拼接真实可解码视频，不覆盖剧集累计实测时长", async () => {
  const root = await mkdtemp(join(tmpdir(), "meiji-assembly-order-"));
  let service;
  try {
    const p = projectFixture(), e = p.episodes[0], media = new MediaStore(join(root, "media"));
    for (const [index, color] of ["red", "blue"].entries()) {
      const file = join(root, `${color}.mp4`);
      const made = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=${color}:s=32x32:d=0.4`, "-c:v", "libx264", "-pix_fmt", "yuv420p", file]);
      assert.equal(made.status, 0, made.stderr.toString());
      const stored = await media.put(p.id, await readFile(file), "mp4");
      e.shot_list.shots[index].video.address = stored.address;
      e.shot_list.shots[index].actual_duration_seconds = 0.4;
    }
    e.actual_duration_seconds = 0.8;
    e.shot_list.shots.reverse();
    stampAssemblyInputs(p);
    const repository = new ModelRepository(join(root, "data")), model = await repository.create(p);
    service = new TaskService({ repository, commitOutput: commitContent, execute: createMediaHandler({ media, gateway: {} }) });
    const submitted = await service.command({ type: "submit", project_id: p.id, request_id: "assembly", business_type: "assembly", target_id: e.id, action: "regenerate" });
    await service.idle(p.id);
    const after = model.read(), task = after.tasks.find(t => t.id === submitted.task_id), steps = after.steps.filter(st => st.task_id === task.id);
    assert.equal(task.task_status, "completed", task.end_reason);
    assert.deepEqual(steps.map(st => [st.kind, st.step_status]), [["precheck", "done"], ["generate", "done"]]);
    const address = after.project.episodes[0].assembly.address;
    assert.ok((await media.validate(address, p.id, "video")).duration > 0);
    const pixel = time => {
      const frame = spawnSync("ffmpeg", ["-v", "error", "-ss", String(time), "-i", media.path(address, p.id), "-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
      assert.equal(frame.status, 0, frame.stderr.toString());
      return frame.stdout;
    };
    const first = pixel(0.05), second = pixel(0.55);
    assert.ok(first[0] > 100 && first[2] < 30, `首段应为红色：${[...first]}`);
    assert.ok(second[2] > 100 && second[0] < 30, `后段应为蓝色：${[...second]}`);
    assert.equal(after.project.episodes[0].actual_duration_seconds, 0.8);
    assert.equal(after.project.episodes[0].duration_seconds, 10);
  } finally { await service?.dispose(); await rm(root, { recursive: true, force: true }); }
});

test("合片缺失、损坏、跨项目或依赖过期的视频在前置失败，保留旧成片且不运行生成", async () => {
  const root = await mkdtemp(join(tmpdir(), "meiji-assembly-invalid-"));
  try {
    const bytes = await mediaBytes(root);
    for (const kind of ["missing", "corrupt", "outside", "stale", "unfinished"]) {
      const p = projectFixture(), e = p.episodes[0], media = new MediaStore(join(root, kind, "media"));
      const old = await media.put(p.id, bytes.video, "mp4");
      e.assembly.address = old.address;
      for (const shot of e.shot_list.shots) shot.video.address = old.address;
      const target = e.shot_list.shots[0];
      if (kind === "missing" || kind === "corrupt") {
        target.video.address = `/api/meiji/media/${p.id}/asset_${crypto.randomUUID()}.mp4`;
        if (kind === "corrupt") await writeFile(media.path(target.video.address, p.id), "broken mp4");
      }
      if (kind === "outside") target.video.address = old.address.replace(p.id, `p_${crypto.randomUUID()}`);
      stampAssemblyInputs(p);
      if (kind === "stale") target.video.node_state.dependency_hash = "f".repeat(64);
      if (kind === "unfinished") { target.video.node_state.status = "rejected"; target.video.node_state.reason = "未完成"; }
      const repository = new ModelRepository(join(root, kind, "data")), model = await repository.create(p);
      const execute = createMediaHandler({ media, gateway: {} }), calls = [];
      const service = new TaskService({ repository, commitOutput: commitContent, execute: context => { calls.push(context.step.kind); return execute(context); } });
      try {
        const submitted = await service.command({ type: "submit", project_id: p.id, request_id: "assembly", business_type: "assembly", target_id: e.id, action: "regenerate" });
        await service.idle(p.id);
        const after = model.read(), task = after.tasks.find(t => t.id === submitted.task_id), steps = after.steps.filter(st => st.task_id === task.id);
        assert.equal(task.task_status, "failed", kind);
        assert.equal(steps[0].kind, "precheck");
        assert.equal(steps[0].step_status, "failed", kind);
        assert.equal(steps[1].step_status, "cancelled", kind);
        assert.equal(calls.includes("generate"), false, kind);
        assert.equal(after.project.episodes[0].assembly.address, old.address);
        assert.deepEqual(after.project.episodes[0].assembly.node_state, e.assembly.node_state);
      } finally { await service.dispose(); }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("定妆照提示词保留参考图与修改意见", async () => {
  const { composeNodePrompt } = await import("../server/http/ai-routes.js");
  for (const kind of ["generate", "regenerate"]) {
    const prompt = composeNodePrompt("costume-image", kind, {
      person: "甲；成年；身材健壮。", costume: "蓝色常服", referenceDescription: "参考图仅用于面相。",
      ...(kind === "regenerate" ? { opinion: "调整发型。" } : {}),
      language: "zh-CN", requirements: "", aspectRatio: "16:9", references: [],
    }, "elysium-image");
    assert.equal(prompt.output.type, "图片");
    assert.ok(prompt.body.length < 550, prompt.body.length);
    assert.doesNotMatch(prompt.body, /裸露/);

    assert.match(prompt.body, /单人全身.*3\/4.*纯色背景/);
    assert.match(prompt.user, /参考图仅用于面相/);
    assert.doesNotMatch(prompt.body, /保留左眉疤痕|补充规则/);
    assert.doesNotMatch(prompt.system, /内容边界|语言要求|需要呈现的文字/);
    if (kind === "regenerate") assert.match(prompt.user, /调整发型/);
  }
});
