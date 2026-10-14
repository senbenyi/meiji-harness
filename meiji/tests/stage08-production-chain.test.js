import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createAppRuntime } from "../server/runtime/app-runtime.js";
import { emptyProject, emptyEpisode } from "../shared/project_contract.js";
const beat = { time_range: "0–5s", action: "秒针走动", camera: "固定", space: "桌面", audio: "咔哒", handoff: "秒针停止", dialogue: [] };

test("S8-06/07 全业务注册制作链，视频失败后新组继续，旧历史不变且媒体有效", async () => {
  const home = await mkdtemp(join(tmpdir(), "meiji-chain-"));
  let runtime;
  try {
    const file = join(home, "fixture.mp4");
    const made = spawnSync("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=32x32:d=0.2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      file,
    ]);
    assert.equal(made.status, 0);
    const bytes = await readFile(file);
    let failVideo = true;
    runtime = await createAppRuntime({
      home,
      gateway: {
        chat: async ({ task, step }) => {
          if (step.kind === "review") return { 是否通过: true, 原因: "" };
          return {
            "script-split": { 剧集: [{ 序号: 1, 起始段落: "P001", 结束段落: "P001", 预估时长秒: 5 }] },
            "project-summary": "钟表静物", "episode-summary": "钟表静物",
            "project-characters": { characters: [] },
            outline: { segments: [{ sequence: 1, duration_seconds: 5, body: "秒针向前走动", causal: "" }] },
            shots: { shots: [{ title: "钟表", number: "S01", duration_seconds: 5, shot_scale: "特写", hook: "揭示", body: "秒针向前走动", continuity_transition: "", reference_anchor: { fixed_landmark: "", character_positions: "", departed_characters: "", lighting: "" }, audio_arrangement: { narration: "", dialogue: "", sound_effects: "" } }] },
            seconds: { storyboard: [beat] },
            storyboard: "integrated_multimodal_description:\n秒针走动，镜头固定，桌面有机械声，结束秒针停止。\noverall_soundscape:\n机械声\nnon_diegetic_music:\n无",
          }[task.business_type];
        },
        submitVideo: async () => {
          if (failVideo) throw Error("模拟网关暂时失败");
          return { id: "remote-chain" };
        },
        retrieveVideo: async () => bytes,
      },
    });
    const p = emptyProject({ name: "完整制作链", creation_mode: "剧本", reference_episode_duration_seconds: 5 });
    p.script.body = "五秒钟表静物";
    const model = await runtime.repository.create(p);
    const submit = async (b, id) => {
      const r = await runtime.tasks.command({
        type: "submit",
        project_id: p.id,
        request_id: crypto.randomUUID(),
        business_type: b,
        target_id: id,
        action: "generate",
      });
      await runtime.tasks.idle(p.id);
      const t = model.read().tasks.find((t) => t.id === r.task_id);
      assert.equal(t.task_status, "completed", t.end_reason);
    };
    for (const b of ["script-split", "project-summary", "project-characters"])
      await submit(b, p.id);
    const e = model.read().project.episodes[0];
    assert.equal(e.plot, "五秒钟表静物");
    assert.equal(e.duration_seconds, 5);
    for (const b of ["outline", "shots"])
      await submit(b, e.id);
    const s = model.read().project.episodes[0].shot_list.shots[0];
    const first = await runtime.tasks.command({
      type: "submit-group",
      project_id: p.id,
      request_id: "film",
      group_type: "episode-film",
      episode_id: e.id,
    });
    await runtime.tasks.idle(p.id);
    const before = model.read(),
      old = before.tasks.filter((t) => t.group_id === first.group_id);
    assert.deepEqual(
      old.map((t) => t.task_status),
      ["completed", "completed", "failed", "superseded"],
    );
    failVideo = false;
    const next = await runtime.tasks.command({
      type: "continue-group",
      project_id: p.id,
      request_id: "continue",
      group_id: first.group_id,
    });
    assert.notEqual(next.group_id, first.group_id);
    await runtime.tasks.idle(p.id);
    assert.deepEqual(
      model.read().tasks.filter((t) => t.group_id === first.group_id),
      old,
    );
    assert.ok(
      model
        .read()
        .tasks.filter((t) => t.group_id === next.group_id)
        .every((t) => t.task_status === "completed"),
    );
    const shotVideo = await runtime.media.validate(model.read().project.episodes[0].shot_list.shots[0].video.address, p.id, "video");
    assert.equal(model.read().project.episodes[0].shot_list.shots[0].actual_duration_seconds, Math.round(shotVideo.duration * 10) / 10);
    assert.equal(model.read().project.episodes[0].shot_list.shots[0].duration_seconds, 5);
    const continued = model.read().tasks.filter((t) => t.group_id === next.group_id);
    assert.equal(continued.at(-1).business_type, "assembly");
    assert.equal(continued.filter(t => t.business_type === "assembly").length, 1);
    const film = await runtime.media.validate(
      model.read().project.episodes[0].assembly.address,
      p.id,
      "video",
    );
    const done = model.read().project.episodes[0];
    assert.ok(done.actual_duration_seconds > 0);
    assert.equal(done.actual_duration_seconds, Math.round(shotVideo.duration * 10) / 10);
    assert.ok(film.duration > 0);
    assert.equal(done.duration_seconds, 5);
  } finally {
    await runtime?.dispose();
    await rm(home, { recursive: true, force: true });
  }
});
