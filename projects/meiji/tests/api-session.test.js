import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createAppRuntime } from "../server/runtime/app-runtime.js";
import { createTaskHttpHandler } from "../server/http/task-routes.js";
import { taskTools } from "../tools/task-tools.js";
import { projectFixture } from "./fixtures/project.js";
import { PanelContext } from "../client/task-client.js";
import { NotificationOutbox } from "../server/host/notification-outbox.js";
import { ModelRepository } from "../server/data/model-repository.js";
import { mergeCharacters } from "../shared/collection-identity.js";
import { LibraryStore } from "../server/data/library-store.js";
import { apply as sessionApply } from "../session.js";

describe("api-session", () => {
  async function httpFixture(work) {
    const home = await mkdtemp(join(tmpdir(), "meiji-api-")),
      messages = [],
      sid = `session-${randomUUID()}`,
      other = `session-${randomUUID()}`;
    let server, runtime;
    try {
      runtime = await createAppRuntime({
        home,
        sessionController: {
          resolveAgent: async (id) => ({
            agent: {
              session: {
                append: (type, data) => {
                  if (type === "command/done") messages.push({ id, type, data });
                },
              },
            },
          }),
        },
        gateway: {
          chat: async ({ step }) =>
            step.kind === "review"
              ? { 是否通过: true, "类型": "", 原因: "" }
              : "新摘要",
        },
      });
      const p = projectFixture();
      await runtime.repository.create(p);
      await runtime.bindings.bind(sid, p.basic_info.id);
      server = createServer(
        createTaskHttpHandler(runtime, {
          authorize: (req) => (req.headers["x-test-auth"] === "1" ? null : 401),
        }),
      );
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const base = `http://127.0.0.1:${server.address().port}`,
        post = async (command, id = sid) => {
          const response = await fetch(base + "/api/meiji/task-command", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Meiji-Request": "1",
              "X-Test-Auth": "1",
            },
            body: JSON.stringify({ session_id: id, command }),
          });
          return { status: response.status, body: await response.json() };
        };
      await work({ runtime, p, sid, other, base, post, messages });
    } finally {
      server?.closeAllConnections();
      if (server) await new Promise((resolve) => server.close(resolve));
      await runtime?.dispose();
      await rm(home, { recursive: true, force: true });
    }
  }

  test("同一真实 HTTP 与会话工具服务，绑定拒绝、通知归属固定", () =>
    httpFixture(async ({ runtime, p, sid, other, post, messages }) => {
      const command = {
        type: "submit",
        project_id: p.basic_info.id,
        request_id: "api",
        business_type: "project-summary",
        target_id: p.basic_info.id,
        action: "regenerate",
      };
      assert.equal((await post(command, other)).status, 403);
      const result = await post(command);
      assert.equal(result.status, 200);
      const tool = taskTools(runtime).find(
          (t) => t.name === "meiji-task-command",
        ),
        again = JSON.parse(
          await tool.execute(
            command,
            { agent: { session: { id: sid } } },
          ),
        );
      assert.equal(result.body.task_id, again.task_id);
      await runtime.tasks.idle(p.basic_info.id);
      await runtime.notices.drain(p.basic_info.id);
      assert.ok(
        messages.some((row) => row.data.text.includes("已通过")),
      );
      assert.ok(messages.every((row) => row.id === sid));
      assert.ok(messages.every((row) => row.type === "command/done"));
      assert.ok(!taskTools(runtime).some((t) => t.name.startsWith("run-")));
    }));
  test("通知失败仍受理，稳定消息 ID 待投递，重连后去重再投递", () =>
    httpFixture(async ({ runtime, p, sid, post }) => {
      // 使用不存在接收者的独立 runtime 验证公开适配失败。
      const home = await mkdtemp(join(tmpdir(), "meiji-outbox-"));
      let available = false;
      const ids = [];
      try {
        const r = await createAppRuntime({
          home,
          sessionController: {
            resolveAgent: async () => ({
              agent: available
                ? {
                    session: {
                      append: (type, data) => {
                        if (type === "command/run") ids.push(data.commandId);
                      },
                    },
                  }
                : null,
            }),
          },
          gateway: {
            chat: async ({ step }) =>
              step.kind === "review"
                ? { 是否通过: true, "类型": "", 原因: "" }
                : "摘要",
          },
        });
        await r.repository.create(p);
        await r.bindings.bind(sid, p.basic_info.id);
        const command = {
            type: "submit",
            project_id: p.basic_info.id,
            request_id: "notify",
            business_type: "project-summary",
            target_id: p.basic_info.id,
            action: "regenerate",
          },
          result = await r.command(command, sid);
        assert.equal(result.accepted, true);
        assert.ok(result.notification_error);
        await r.tasks.idle(p.basic_info.id);
        const noticeIds = (await r.repository.open(p.basic_info.id))
          .readAll()
          .runtime.outbox.map((n) => n.id);
        available = true;
        await r.notices.drain(p.basic_info.id);
        await r.notices.drain(p.basic_info.id);
        assert.deepEqual(ids, noticeIds);
        assert.equal((await r.command(command, sid)).task_id, result.task_id);
        await r.dispose();
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    }));
  test("旧端点不再存在，鉴权与同源写入检查保留", () =>
    httpFixture(async ({ base, p, sid }) => {
      assert.equal((await fetch(base + "/api/meiji/projects")).status, 401);
      const unknown = await fetch(base + "/api/meiji/not-an-endpoint", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Test-Auth": "1", "X-Meiji-Request": "1" },
        body: JSON.stringify({ session_id: sid }),
      });
      assert.equal(unknown.status, 404);
      assert.deepEqual(await unknown.json(), { message: "端点不存在" });
      assert.equal(
        (
          await fetch(base + "/plugins/meiji/runs", {
            headers: { "X-Test-Auth": "1" },
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await fetch(base + "/api/meiji/task-command", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Auth": "1" },
            body: "{}",
          })
        ).status,
        403,
      );
    }));

  test("面板可加载英文共享契约及嵌套Model模块，拒绝越界模块路径", () =>
    httpFixture(async ({ base }) => {
      for (const path of ["task_contract.js", "project_contract.js", "models/costume_image_model.js", "models/node_state_model.js", "prompt-models/outline.js"]) {
        const response = await fetch(`${base}/plugins/meiji/shared/${path}`);
        assert.equal(response.status, 200, path);
        assert.match(response.headers.get("content-type"), /javascript/);
      }
      const response = await fetch(`${base}/plugins/meiji/shared/models/%2e%2e%2fserver.js`);
      assert.equal(response.status, 404);
    }));

  test('真实HTTP可加载workbench完整模块图，所有浏览器依赖均可获取', () =>
    httpFixture(async ({base}) => {
      const visited = new Set();
      async function visit(url) {
        if (visited.has(url.pathname)) return;
        visited.add(url.pathname);
        assert.equal(url.origin,base,'浏览器依赖必须来自本服务');
        const response = await fetch(url);
        assert.equal(response.status,200,url.pathname);
        assert.match(response.headers.get('content-type'),/javascript/,url.pathname);
        const source = await response.text();
        for (const [,path] of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g)) {
          assert.ok(path.startsWith('.') || path.startsWith('/plugins/meiji/') || path.startsWith('/plugins/drama/'),`非浏览器依赖 ${path}`);
          await visit(new URL(path,url));
        }
      }
      await visit(new URL('/plugins/meiji/client/workbench.js',base));
      assert.ok(visited.has('/plugins/meiji/shared/prompt-models/storyboard.js'));
      for (const name of ['project-forms', 'project-detail', 'settings-ui', 'panel-dom'])
        assert.ok(visited.has(`/plugins/drama/src/client/${name}.js`));
      const styles = await fetch(new URL('/plugins/drama/src/client/project-ui.css', base));
      assert.equal(styles.status, 200);
      assert.match(styles.headers.get('content-type'), /css/);
      assert.match(await styles.text(), /settings-option/);
    }));

  test("面板快照只含未结束任务；已结束任务经项目关联ID按需读取摘要、详情与历史", () =>
    httpFixture(async ({ runtime, p, sid, base, post }) => {
      const headers = { "X-Test-Auth": "1" };
      const get = async path => { const response = await fetch(`${base}${path}`, { headers }); return { status: response.status, body: await response.json() }; };
      const submitted = await post({
        type: "submit", project_id: p.basic_info.id, request_id: "panel-snapshot",
        business_type: "project-summary", target_id: p.basic_info.id, action: "regenerate",
      });
      assert.equal(submitted.status, 200);
      await runtime.tasks.idle(p.basic_info.id);
      const snapshot = (await get(`/api/meiji/context?session_id=${sid}`)).body.snapshot;
      // 任务已结束：工作快照不再携带，项目 JSON 记录最近任务 ID。
      assert.deepEqual(snapshot.tasks, []);
      assert.deepEqual(snapshot.steps, []);
      const taskId = snapshot.project.latest_tasks[`project-summary:${p.basic_info.id}`];
      assert.equal(taskId, submitted.body.task_id);
      const summary = await get(`/api/meiji/records?session_id=${sid}&task_ids=${taskId}`);
      assert.equal(summary.status, 200);
      const row = summary.body.groups[0];
      assert.equal(row.tasks[0].id, taskId);
      assert.ok(["completed", "rejected", "failed"].includes(row.status));
      const generated = row.steps.find(step => step.kind === "generate");
      assert.equal(generated.executor, "ai");
      assert.equal(generated.has_prompt, true);
      assert.equal(Object.hasOwn(generated, "prompt"), false);
      assert.equal(row.steps.find(step => step.kind === "precheck").executor, "program");
      const detail = await get(`/api/meiji/group?session_id=${sid}&group_id=${row.group.id}`);
      assert.equal(detail.status, 200);
      const record = detail.body.steps.find(step => step.id === generated.id);
      assert.ok(Array.isArray(record.prompt.messages) && record.prompt.messages.length);
      for (const key of ["system", "user", "body", "transfers"]) assert.equal(Object.hasOwn(record.prompt, key), false, key);
      assert.ok(Array.isArray(record.http));
      assert.equal(detail.body.steps.find(step => step.kind === "precheck").prompt, null);
      assert.equal((await get(`/api/meiji/group?session_id=${sid}&group_id=tg_missing`)).status, 404);
      const history = await get(`/api/meiji/history?session_id=${sid}&business=project-summary`);
      assert.equal(history.body.total, 1);
      assert.equal(history.body.groups[0].group.id, row.group.id);
      assert.equal((await get(`/api/meiji/history?session_id=${sid}&business=outline`)).body.total, 0);
    }));

  test("提交直接返回正在进行的任务组快照", () =>
    httpFixture(async ({ p, post }) => {
      const submitted = await post({
        type: "submit", project_id: p.basic_info.id, request_id: "group-snapshot",
        business_type: "project-summary", target_id: p.basic_info.id, action: "regenerate",
      });
      assert.equal(submitted.status, 200);
      const body = submitted.body;
      // 提交只新增最近任务关联，以 links 增量返回，不算作正文变化。
      assert.equal(body.content, false);
      assert.equal(body.links.latest_tasks[`project-summary:${p.basic_info.id}`], body.task_id);
      assert.equal(body.groups.length, 1);
      const view = body.groups[0];
      assert.equal(view.tasks[0].id, body.task_id);
      assert.equal(view.tasks[0].task_status, "queued");
      assert.equal(view.tasks[0].business_type, "project-summary");
      assert.equal(view.tasks[0].target_id, p.basic_info.id);
      assert.ok(view.steps.length);
      assert.equal(view.steps.every(step => !Object.hasOwn(step, "prompt") && typeof step.has_prompt === "boolean"), true);
    }));

  test("节点用任务组快照直接替换对应任务", () => {
    const context = new PanelContext();
    context.select("session", "project");
    assert.equal(context.accept(context.token(), {
      project: { basic_info: { id: "project" } },
      tasks: [{ id: "old", group_id: "g1", task_status: "completed" }],
      steps: [{ id: "s-old", task_id: "old", prompt: "keep" }],
      groups: [{ id: "g1" }],
      runtime: { revision: 4 },
    }), true);
    assert.equal(context.mergeGroups([{
      group: { id: "g2" },
      tasks: [{ id: "new", group_id: "g2", business_type: "project-characters", target_id: "project", task_status: "queued" }],
      steps: [{ id: "s-new", task_id: "new", has_prompt: true }],
    }], 5), true);
    const snapshot = context.read();
    assert.equal(snapshot.runtime.revision, 5);
    assert.equal(snapshot.tasks.find(task => task.id === "old").task_status, "completed");
    assert.equal(snapshot.steps.find(step => step.id === "s-old").prompt, "keep");
    assert.equal(snapshot.tasks.find(task => task.id === "new").task_status, "queued");
    assert.equal(context.mergeGroups([{
      group: { id: "g2" },
      tasks: [{ id: "new", group_id: "g2", task_status: "running" }],
      steps: [{ id: "s-new", task_id: "new", step_status: "running" }],
    }], 4), false);
    assert.equal(context.read().tasks.find(task => task.id === "new").task_status, "queued");
  });
});

describe("boundaries", () => {
  test("投递期间新增通知同次清空，不依赖后续命令", async () => {
    const root = await mkdtemp(join(tmpdir(), "meiji-outbox-"));
    try {
      const p = projectFixture(),
        repo = new ModelRepository(root),
        model = await repo.create(p),
        sid = `session-${randomUUID()}`,
        ids = [];
      const notice = (id) => ({
        id,
        session_id: sid,
        project_id: p.basic_info.id,
        event: "completed",
        delivery_status: "pending",
        error: "",
      });
      await model.update("seed", {}, (s) => {
        s.runtime.outbox.push(notice("notice-first"));
        return {};
      });
      const outbox = new NotificationOutbox(repo, {
        resolveAgent: async () => ({
          agent: {
            session: { append: async (type, data) => {
              if (type !== "command/run") return;
              ids.push(data.commandId);
              if (ids.length === 1)
                await model.update("append", {}, (s) => {
                  s.runtime.outbox.push(notice("notice-second"));
                  return {};
                });
            } },
          },
        }),
      });
      await outbox.drain(p.basic_info.id);
      assert.deepEqual(ids, ["notice-first", "notice-second"]);
      assert.ok(
        model
          .read()
          .runtime.outbox.every((n) => n.delivery_status === "delivered"),
      );
      await outbox.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  test("创建契约不接受外部 ID/状态，项目同名不产生工作区重名冲突", async () => {
    const home = await mkdtemp(join(tmpdir(), "meiji-create-"));
    let runtime;
    try {
      const titles = [];
      let sid;
      runtime = await createAppRuntime({
        home,
        workspaceController: {
          create: async () => ({ workspace: { workspaceId: randomUUID() } }),
          rename: async ({ title }) => {
            assert.ok(!titles.includes(title));
            titles.push(title);
          },
        },
        sessionController: {
          create: async () => ({ sessionId: (sid = `session-${randomUUID()}`) }),
          resolveAgent: async () => ({ agent: null }),
        },
      });
      await assert.rejects(
        runtime.projectCommand(
          {
            type: "create",
            fields: { basic_info: { id: "p_injected", name: "注入", creative_requirements: "方向" } },
          },
          null,
        ),
        /不接受/,
      );
      for (let i = 0; i < 2; i++)
        await runtime.projectCommand(
          { type: "create", fields: { basic_info: { name: "同名项目", creation_mode: "自由创作", creative_requirements: "方向" } } },
          null,
        );
      const entries = await runtime.repository.list();
      assert.equal(entries.length, 2);
      await assert.rejects(
        runtime.projectCommand(
          {
            type: "add-episode",
            project_id: await runtime.bindings.projectForSession(sid),
            request_id: "inject",
            fields: { id: "e_injected" },
          },
          sid,
        ),
        /未定义|创建项目不接受/,
      );
    } finally {
      await runtime?.dispose();
      await rm(home, { recursive: true, force: true });
    }
  });
  test("公开 skill 注册使用合法名称，双端工具随会话卸载", async () => {
    const names = [],
      effects = [];
    await sessionApply({
      meiji: { ready: Promise.resolve() },
      tools: {
        register: (t) => {
          names.push(t.name);
          return () => names.pop();
        },
      },
      skills: {
        register: (s) => {
          assert.match(s.name, /^[a-z][a-z0-9-]*$/);
          return () => {};
        },
      },
      effect: (fn) => effects.push(fn()),
    });
    assert.equal(names.length, 3);
    for (const fn of effects.reverse()) fn();
    assert.equal(names.length, 0);
  });
  test("独立素材沿用现有目录格式，引用阻止删除，不读取旧项目", async () => {
    const root = await mkdtemp(join(tmpdir(), "meiji-assets-"));
    try {
      assert.deepEqual(await new LibraryStore(join(root, "not-created")).list(), []);
      const invalidDirectory = join(root, "not-a-directory");
      await writeFile(invalidDirectory, "file");
      await assert.rejects(new LibraryStore(invalidDirectory).list(), { code: "ENOTDIR" });
      const id = randomUUID(),
        directory = join(root, "characters", id);
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, "metadata.json"),
        JSON.stringify({
          version: 1,
          id,
          category: "characters",
          originalName: "保留.png",
          file: "original.png",
          mime: "image/png",
          createdAt: new Date().toISOString(),
        }),
      );
      await writeFile(join(directory, "original.png"), "image");
      const library = new LibraryStore(root),
        p = projectFixture(),
        repository = {
          list: async () => [],
          open: async () => ({ read: () => ({ project: p }) }),
        };
      assert.equal((await library.list())[0].originalName, "保留.png");
      assert.equal((await library.file(id)).bytes.toString(), "image");
      const imported = await library.command(
        {
          type: "import",
          name: "剧本.txt",
          category: "scripts",
          data:
            "data:text/plain;base64," + Buffer.from("剧本").toString("base64"),
        },
        repository,
      );
      assert.equal((await library.list()).length, 2);
      await library.command(
        { type: "delete", id: imported.asset.id },
        repository,
      );
      assert.equal((await library.list()).length, 1);
      const object_id = `c_${randomUUID()}`;
      p.character_library.characters.push({ id: object_id, costumes: [] });
      await library.command(
        { type: "reference", id, project_id: p.basic_info.id, object_id },
        repository,
      );
      assert.deepEqual(await library.references(), [object_id]);
      await assert.rejects(
        library.command({ type: "delete", id }, repository),
        /仍被项目引用/,
      );
      await library.command(
        { type: "unreference", id, project_id: p.basic_info.id, object_id },
        repository,
      );
      await library.command({ type: "delete", id }, repository);
      assert.equal((await library.list()).length, 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("画幅、声音和默认服装不追溯过期，项目不再接受语言或规则", async () => {
    const home = await mkdtemp(join(tmpdir(), "meiji-config-"));
    let runtime;
    try {
      runtime = await createAppRuntime({ home });
      const p = projectFixture(),
        sid = `session-${randomUUID()}`;
      p.character_library.characters = mergeCharacters(p, [
        {
          name: "甲", gender: "男", era: "宋代", position: "主角", age_range: "成年", body_type: "健壮", hairstyle: "短发", signature_props: [], immutable_traits: [],
          costumes: [{ name: "白衣", color: "白色", material: "", props: [] }, { name: "黑衣", color: "黑色", material: "", props: [] }],
        },
      ]).characters;
      const c = p.character_library.characters[0];
      c.voice = "旧声音";
      c.costume_images[0] = { ...c.costume_images[0], costume_id: c.costumes[0].id, node_state: { status: "generated", reason: "", dependency_hash: "" }, address: "original.png" };
      for (const image of c.costume_images)
        Object.assign(image, { node_state: { status: "generated", reason: "", dependency_hash: "" }, address: "costume.png" });
      const model = await runtime.repository.create(p);
      await runtime.bindings.bind(sid, p.basic_info.id);
      await runtime.projectCommand(
        {
          type: "edit",
          project_id: p.basic_info.id,
          request_id: "settings",
          fields: { basic_info: { aspect_ratio: "9:16" } },
        },
        sid,
      );
      await runtime.projectCommand(
        {
          type: "edit-character",
          project_id: p.basic_info.id,
          request_id: "voice-default",
          target_id: c.id,
          fields: { voice: "新声音", default_costume_id: c.costumes[1].id },
        },
        sid,
      );
      const after = model.read().project;
      assert.equal(Object.hasOwn(after, "rules"), false);
      assert.equal(Object.hasOwn(after, "output_language"), false);
      assert.deepEqual(after.episodes, p.episodes);
      assert.deepEqual(after.character_library.characters[0].costume_images[0], c.costume_images[0]);
      assert.deepEqual(after.character_library.characters[0].costumes, c.costumes);
      await assert.rejects(
        runtime.projectCommand(
          {
            type: "edit",
            project_id: p.basic_info.id,
            request_id: "bad-rule",
            fields: { rules: [] },
          },
          sid,
        ),
        /未定义项目配置/,
      );
      await assert.rejects(
        runtime.projectCommand(
          { type: "edit", project_id: p.basic_info.id, request_id: "bad-language", fields: { output_language: "en" } },
          sid,
        ),
        /未定义项目配置/,
      );
    } finally {
      await runtime?.dispose();
      await rm(home, { recursive: true, force: true });
    }
  });
});
