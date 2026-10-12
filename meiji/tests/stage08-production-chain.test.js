import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createAppRuntime } from "../server/runtime/app-runtime.js";
import { emptyProject, emptyEpisode } from "../shared/project-contract.js";
const beat = {
  开始秒: 0,
  结束秒: 5,
  动作: "秒针走动",
  镜头: "固定",
  空间: "桌面",
  声音: "咔哒",
  交接: "秒针停止",
  对白: [],
};
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
            "script-split": {
              剧集: [
                { 序号: 1, 起始段落: "P001", 结束段落: "P001", 预估时长秒: 5 },
              ],
            },
            "project-summary": { 正文: "钟表静物" },
            "project-characters": { 角色: [] },
            outline: { 小段: [{ 序号: 1, 时长秒: 5, 正文: "秒针向前走动", 因果: "" }] },
            shots: {
              镜头: [
                {
                  编号: "S01",
                  标题: "钟表",
                  参考时长: 5,
                  正文: "秒针向前走动",
                },
              ],
            },
            seconds: {
              衔接上一镜方式: "首镜",
              内容: { 事件: "秒针走动", 节拍: [beat], 环境声: [], 配乐: [] },
            },
            storyboard: {
              正文: [
                {
                  开始秒: 0,
                  结束秒: 5,
                  动作: "秒针走动",
                  镜头: "固定",
                  空间: "桌面",
                  同步声音: "机械声",
                  对白: "",
                  心声: "",
                  结尾状态: "秒针停止",
                },
              ],
              环境声: "",
              配乐: "",
            },
          }[task.business_type];
        },
        submitVideo: async () => {
          if (failVideo) throw Error("模拟网关暂时失败");
          return { id: "remote-chain" };
        },
        retrieveVideo: async () => bytes,
      },
    });
    const p = emptyProject({ 名称: "完整制作链", 创作方式: "剧本" });
    p.剧本.正文 = "五秒钟表静物";
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
    const e = model.read().project.剧集[0];
    assert.equal(e.剧情, "五秒钟表静物");
    assert.equal(e.时长秒, 5);
    for (const b of ["outline", "shots"])
      await submit(b, e.id);
    const s = model.read().project.剧集[0].镜头表.镜头[0];
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
    await runtime.tasks.command({
      type: "start-queued",
      project_id: p.id,
      request_id: "start",
      task_id: next.task_ids[0],
    });
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
    assert.equal(model.read().project.剧集[0].实际时长秒, 0);
    const shotVideo = await runtime.media.validate(model.read().project.剧集[0].镜头表.镜头[0].视频.地址, p.id, "video");
    assert.equal(model.read().project.剧集[0].镜头表.镜头[0].实际时长秒, Math.round(shotVideo.duration * 10) / 10);
    assert.equal(model.read().project.剧集[0].镜头表.镜头[0].时长秒, 5);
    await submit("assembly", e.id);
    const film = await runtime.media.validate(
      model.read().project.剧集[0].合片.地址,
      p.id,
      "video",
    );
    const done = model.read().project.剧集[0];
    assert.ok(done.实际时长秒 > 0);
    assert.equal(done.实际时长秒, Math.round(film.duration * 10) / 10);
    assert.equal(done.时长秒, 5);
  } finally {
    await runtime?.dispose();
    await rm(home, { recursive: true, force: true });
  }
});
