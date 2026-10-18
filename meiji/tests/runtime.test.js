import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, mkdir, writeFile, symlink, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAppRuntime } from "../server/runtime/app-runtime.js";
import { ModelRepository } from "../server/data/model-repository.js";
import { TaskService } from "../server/flow/tasks/task-manager.js";
import { createHandlerRegistry } from "../server/handlers/handler-registry.js";
import { commitContent } from "../server/handlers/content.js";
import { projectFixture } from "./fixtures/project.js";
import { spawnSync, spawn } from "node:child_process";
import { emptyProject } from "../shared/project_contract.js";
import { fileURLToPath } from "node:url";

describe("episode-nodes", () => {
  test("剧集参考时长经项目命令修改：主链过期、摘要不变，旧内容和 hash 保留", async () => {
    const home = await mkdtemp(join(tmpdir(), "meiji-episode-duration-"));
    let runtime;
    try {
      runtime = await createAppRuntime({ home });
      const project = projectFixture(), episode = project.episodes[0];
      const model = await runtime.repository.create(project), session = `session-${crypto.randomUUID()}`;
      await runtime.bindings.bind(session, project.id);
      await runtime.projectCommand({ type: "edit-episode", project_id: project.id, request_id: "same", episode_id: episode.id, fields: { duration_seconds: 10 } }, session);
      assert.equal(model.readAll().project.episodes[0].story_outline.node_state.status, "generated");
      await runtime.projectCommand({ type: "edit-episode", project_id: project.id, request_id: "changed", episode_id: episode.id, fields: { duration_seconds: 60 } }, session);
      const next = model.readAll().project.episodes[0];
      assert.equal(next.summary.node_state.status, "generated");
      for (const key of ["story_outline", "shot_list", "assembly"]) {
        assert.equal(next[key].node_state.status, "expired");
        assert.equal(next[key].node_state.dependency_hash, episode[key].node_state.dependency_hash);
      }
      assert.equal(next.story_outline.segments[0].body, episode.story_outline.segments[0].body);
      assert.equal(next.shot_list.shots[0].video.node_state.status, "expired");
      assert.equal(next.shot_list.shots[0].video.address, episode.shot_list.shots[0].video.address);
    } finally {
      await runtime?.dispose();
      await rm(home, { recursive: true, force: true });
    }
  });

  test("视频写回立即累计剧集实测时长；整集导入不覆盖，删镜重算且终态历史仍可读", async () => {
    const root = await mkdtemp(join(tmpdir(), "meiji-episode-actual-"));
    const repository = new ModelRepository(root), project = projectFixture(), episode = project.episodes[0];
    let service;
    try {
      for (const shot of episode.shot_list.shots) shot.actual_duration_seconds = 0;
      const model = await repository.create(project);
      service = new TaskService({ repository, commitOutput: commitContent, execute: createHandlerRegistry({
        text: async () => { throw Error("人工编辑不调用 AI"); },
        media: async ({ step, draft }) => ({ content: step.kind === "apply" ? { ...draft, last_frame: {address: "import-tail.png"} } : step.result.input, result: step.result?.input }),
      }) });
      const imported = [];
      for (const [index, duration] of [5.2, 6.1].entries()) {
        const result = await service.command({ type: "manual-edit", project_id: project.id, request_id: `video-${index}`, business_type: "video", target_id: episode.shot_list.shots[index].id, content: { address: `import-${index}.mp4`, actual_duration_seconds: duration } });
        await service.idle(project.id);
        assert.equal(model.readAll().tasks.find(t => t.id === result.task_id).task_status, "completed");
        assert.equal(model.readAll().project.episodes[0].actual_duration_seconds, index ? 11.3 : 5.2);
        imported.push(result.task_id);
      }
      await service.command({ type: "manual-edit", project_id: project.id, request_id: "assembly", business_type: "assembly", target_id: episode.id, content: { address: "whole-episode.mp4", actual_duration_seconds: 99 } });
      await service.idle(project.id);
      assert.equal(model.readAll().project.episodes[0].actual_duration_seconds, 11.3);
      assert.equal(model.readAll().steps.at(-1).result.actual_duration_seconds, 99);
      const shot = model.readAll().project.episodes[0].shot_list.shots[1];
      const fields = ["title", "id", "duration_seconds", "shot_scale", "hook", "body", "continuity_transition", "reference_anchor", "audio_arrangement", "on_screen_characters", "background_characters"];
      await service.command({ type: "manual-edit", project_id: project.id, request_id: "remove-shot", business_type: "shots", target_id: episode.id, content: { shots: [Object.fromEntries(fields.map(key => [key, shot[key]]))] } });
      await service.idle(project.id);
      const after = model.readAll();
      assert.equal(after.project.episodes[0].actual_duration_seconds, 6.1);
      assert.equal(after.project.episodes[0].duration_seconds, 10);
      assert.equal(after.project.episodes[0].shot_list.shots[0].id, shot.id);
      assert.equal(after.project.episodes[0].assembly.node_state.status, "expired");
      for (const id of imported) {
        const history = await service.command({ type: "query", project_id: project.id, task_id: id });
        assert.equal(history.task.task_status, "completed");
      }
    } finally {
      await service?.dispose(); await repository.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("production-chain", () => {
  const beat = { time_range: "0–5s", action: "秒针走动", camera: "固定", space: "桌面", audio: "咔哒", handoff: "秒针停止", dialogue: [] };

  test("全业务注册制作链，视频失败后新组继续，旧历史不变且媒体有效", async () => {
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
        "color=c=blue:s=32x32:d=4",
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
            if (step.kind === "review") return { 是否通过: true, "类型": "", 原因: "" };
            return {
              "script-split": { 剧集: [{ 序号: 1, 本集规划: "钟表秒针走动，建立时间压力并停在下一步行动前。", 预估时长秒: 5 }] },
              "project-summary": "钟表静物", "episode-summary": "钟表静物",
              "project-characters": { characters: [] },
              "episode-scenes": { scenes: [] },
              outline: { segments: [{ sequence: 1, duration_seconds: 5, body: "秒针向前走动", causal: "" }] },
              shots: { shots: [{ title: "钟表", id: "", duration_seconds: 5, shot_scale: "特写", hook: "揭示", body: "秒针向前走动", continuity_transition: "", reference_anchor: { fixed_landmark: "", character_positions: "", departed_characters: "", lighting: "" }, on_screen_characters: [], background_characters: "", audio_arrangement: { narration: "", dialogue: "", sound_effects: "" } }] },
              seconds: { end_state: "人物位于镜末位置，动作已完成。", pending_actions: "", pending_dialogue: "", continuing_audio: "", storyboard: [beat] },
              storyboard: "integrated_multimodal_description:\n[Shot 1] 秒针走动，镜头固定，桌面有机械声，结束秒针停止。\noverall_soundscape:\n机械声\nnon_diegetic_music:\n无",
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
        const t = model.readAll().tasks.find((t) => t.id === r.task_id);
        assert.equal(t.task_status, "completed", t.end_reason);
      };
      for (const b of ["script-split", "project-summary", "project-characters"])
        await submit(b, p.id);
      const e = model.readAll().project.episodes[0];
      assert.equal(e.plot, "钟表秒针走动，建立时间压力并停在下一步行动前。");
      assert.equal(e.duration_seconds, 5);
      for (const b of ["outline", "episode-scenes", "shots"])
        await submit(b, e.id);
      const first = await runtime.tasks.command({
        type: "submit-group",
        project_id: p.id,
        request_id: "film",
        group_type: "episode-film",
        episode_id: e.id,
      });
      await runtime.tasks.idle(p.id);
      const before = model.readAll(),
        old = before.tasks.filter((t) => t.group_id === first.group_id);
      assert.deepEqual(
        old.map((t) => t.task_status),
        ["completed", "completed", "failed"],
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
        model.readAll().tasks.filter((t) => t.group_id === first.group_id),
        old,
      );
      assert.ok(
        model
          .readAll()
          .tasks.filter((t) => t.group_id === next.group_id)
          .every((t) => t.task_status === "completed"),
      );
      const shotVideo = await runtime.media.validate(model.readAll().project.episodes[0].shot_list.shots[0].video.address, p.id, "video");
      assert.equal(model.readAll().project.episodes[0].shot_list.shots[0].actual_duration_seconds, Math.round(shotVideo.duration * 10) / 10);
      assert.equal(model.readAll().project.episodes[0].shot_list.shots[0].duration_seconds, 5);
      const continued = model.readAll().tasks.filter((t) => t.group_id === next.group_id);
      assert.equal(continued.at(-1).business_type, "assembly");
      assert.equal(continued.filter(t => t.business_type === "assembly").length, 1);
      const film = await runtime.media.validate(
        model.readAll().project.episodes[0].assembly.address,
        p.id,
        "video",
      );
      const done = model.readAll().project.episodes[0];
      assert.ok(done.actual_duration_seconds > 0);
      assert.equal(done.actual_duration_seconds, Math.round(shotVideo.duration * 10) / 10);
      assert.ok(film.duration > 0);
      assert.equal(done.duration_seconds, 5);
    } finally {
      await runtime?.dispose();
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("restart", () => {
  const repo = fileURLToPath(new URL("../../", import.meta.url)),
    harness = fileURLToPath(
      new URL("../../../deepseek-harness", import.meta.url),
    );
  async function result(child) {
    let text = "";
    child.stdout?.on("data", (bytes) => (text += bytes));
    child.stderr?.on("data", (bytes) => (text += bytes));
    const code = await new Promise((resolve) => child.once("exit", resolve));
    return { code, text };
  }
  for (const mode of ["success", "foreign", "refuse-stop"])
    test(`restart-harness ${mode}：旧进程退出后才能启动`, async () => {
      const root = await mkdtemp(join(tmpdir(), "meiji-restart-script-")),
        fake = join(root, "harness"),
        home = join(root, "home"),
        bin = join(root, "bin");
      let old;
      try {
        await mkdir(join(fake, "apps/cli/src"), { recursive: true });
        await mkdir(join(fake, "apps/web/dist"), { recursive: true });
        await mkdir(join(home, "profiles/web/node_modules/@meiji"), {
          recursive: true,
        });
        await mkdir(bin);
        await symlink(join(harness, "node_modules"), join(fake, "node_modules"));
        await symlink(
          join(repo, "meiji"),
          join(home, "profiles/web/node_modules/@meiji/harness-plugin"),
        );
        await writeFile(
          join(home, "profiles/web/package.json"),
          JSON.stringify({
            dsh: { profile: { bundles: ["@meiji/harness-plugin"] } },
          }),
        );
        await writeFile(join(fake, "apps/web/dist/index.html"), "fixture");
        const entry = join(fake, "apps/cli/src/bin.ts");
        await writeFile(
          entry,
          `if(process.env.FIXTURE_OLD==='1'){${mode === "refuse-stop" ? "process.on('SIGTERM',()=>{});" : ""}process.stdout.write('OLD_READY\\n');setInterval(()=>{},1000)}else console.log('NEW_STARTED')`,
        );
        old = spawn(process.execPath, [entry, "web"], {
          cwd: fake,
          env: { ...process.env, FIXTURE_OLD: "1" },
        });
        await new Promise((resolve) => old.stdout.once("data", resolve));
        await writeFile(
          join(bin, "lsof"),
          `#!/usr/bin/env bash\nif [[ "$*" == *"-d cwd"* ]]; then echo 'n${await realpath(fake)}'; elif kill -0 ${old.pid} 2>/dev/null; then echo ${old.pid}; fi\n`,
          { mode: 0o700 },
        );
        await writeFile(
          join(bin, "ps"),
          `#!/usr/bin/env bash\necho '${mode === "foreign" ? "unrelated fixture" : entry + " web"}'\n`,
          { mode: 0o700 },
        );
        await writeFile(
          join(bin, "sleep"),
          "#!/usr/bin/env bash\n/bin/sleep 0.05\n",
          { mode: 0o700 },
        );
        const child = spawn("bash", [join(repo, "restart-harness.sh")], {
            env: {
              ...process.env,
              PATH: bin + ":" + process.env.PATH,
              HARNESS_DIR: fake,
              DSH_HOME: home,
              FIXTURE_OLD: "0",
            },
          }),
          output = await result(child);
        if (mode === "success") {
          assert.equal(output.code, 0, output.text);
          assert.ok(output.text.includes("NEW_STARTED"));
          assert.ok(old.exitCode !== null || old.signalCode !== null);
        } else {
          assert.notEqual(output.code, 0);
          assert.ok(!output.text.includes("NEW_STARTED"));
          assert.ok(
            output.text.includes(mode === "foreign" ? "非预期进程" : "未退出"),
          );
        }
      } finally {
        if (old?.exitCode === null && old.signalCode === null) {
          const closed = new Promise((resolve) => old.once("exit", resolve));
          old.kill("SIGKILL");
          await closed;
        }
        await rm(root, { recursive: true, force: true });
      }
    });
});
