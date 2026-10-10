import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ModelRepository } from "../server/data/model-repository.js";
import { TaskService } from "../server/flow/tasks/task-service.js";
import { createMediaHandler } from "../server/handlers/media-handler.js";
import { commitContent } from "../server/handlers/content.js";
import { MediaStore } from "../server/media/media-store.js";
import { mergeCharacters } from "../shared/collection-identity.js";
import { projectFixture } from "./fixtures/project.js";
export async function mediaBytes(root) {
  const video = join(root, "source.mp4"),
    image = join(root, "source.png");
  for (const args of [
    [
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=32x32:d=0.2",
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

test("S6-01/02/03/04 真实媒体文件经过图片、视频、尾帧与合片执行链", async () => {
  const root = await mkdtemp(join(tmpdir(), "meiji-media-tasks-"));
  try {
    const bytes = await mediaBytes(root),
      p = projectFixture(),
      e = p.剧集[0];
    e.时长秒 = 5;
    e.故事大纲.小段[0].时长秒 = 5;
    e.镜头表.镜头 = e.镜头表.镜头.slice(0, 1);
    p.角色库.角色 = mergeCharacters(p, [
      {
        编号: "C01",
        名称: "甲",
        国籍: "",
        身份: "",
        身份特征: "",
        性别: "",
        年代: "",
        年龄: "",
        身高: "",
        体型: "",
        面相: "",
        声音: "低沉",
        必出: true,
        默认服装编号: "C01-01",
        服装: [{ 编号: "C01-01", 名称: "常服", 描述: "白衣" }],
      },
    ]).characters;
    const c = p.角色库.角色[0],
      co = c.服装[0],
      s = e.镜头表.镜头[0];
    s.出镜角色 = [{ 角色id: c.id, 服装id: co.id }];
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
    await submit("character-image", c.id, "generate");
    assert.equal(calls[0].references.length, 0);
    assert.ok(!calls[0].prompt.includes("低沉"));
    await submit("costume-image", co.id, "generate");
    assert.equal(calls[1].references.length, 1);
    const video = await submit("video", s.id, "regenerate");
    assert.equal(
      model
        .read()
        .steps.find(
          (st) => st.task_id === video.task_id && st.kind === "generate",
        ).result.remote_id,
      "remote-test",
    );
    await submit("tail", s.id, "regenerate");
    const info = await media.validate(model.read().project.剧集[0].镜头表.镜头[0].视频.地址, p.id, "video");
    assert.equal(model.read().project.剧集[0].镜头表.镜头[0].实际时长秒, Math.round(info.duration * 10) / 10);
    const restored = await new ModelRepository(join(root, "projects")).open(p.id);
    assert.equal(restored.read().project.剧集[0].镜头表.镜头[0].实际时长秒, Math.round(info.duration * 10) / 10);
    await submit("assembly", e.id, "regenerate");
    await media.validate(model.read().project.剧集[0].合片.地址, p.id, "video");
    await assert.rejects(
      media.put(p.id, Buffer.from("invalid"), "png"),
      /媒体|Invalid|invalid|Invalid data|ffprobe/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
