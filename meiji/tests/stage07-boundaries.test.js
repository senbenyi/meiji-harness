import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createAppRuntime } from "../server/runtime/app-runtime.js";
import { NotificationOutbox } from "../server/host/notification-outbox.js";
import { ModelRepository } from "../server/data/model-repository.js";
import { projectFixture } from "./fixtures/project.js";
import { mergeCharacters } from "../shared/collection-identity.js";
import { LibraryStore } from "../server/data/library-store.js";
import { apply as sessionApply } from "../session.js";

test("S7-08 投递期间新增通知同次清空，不依赖后续命令", async () => {
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
      project_id: p.id,
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
    await outbox.drain(p.id);
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
test("S7-09 创建契约不接受外部 ID/状态，项目同名不产生工作区重名冲突", async () => {
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
          fields: { id: "p_injected", 名称: "注入", 创作方向: "方向" },
        },
        null,
      ),
      /不接受/,
    );
    for (let i = 0; i < 2; i++)
      await runtime.projectCommand(
        { type: "create", fields: { 名称: "同名项目", 创作方向: "方向" } },
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
      /未定义/,
    );
  } finally {
    await runtime?.dispose();
    await rm(home, { recursive: true, force: true });
  }
});
test("S7-10 公开 skill 注册使用合法名称，双端工具随会话卸载", async () => {
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
test("S7-11 独立素材沿用现有目录格式，引用阻止删除，不读取旧项目", async () => {
  const root = await mkdtemp(join(tmpdir(), "meiji-assets-"));
  try {
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
    p.角色库.角色.push({ id: object_id, 服装: [] });
    await library.command(
      { type: "reference", id, project_id: p.id, object_id },
      repository,
    );
    assert.deepEqual(await library.references(), [object_id]);
    await assert.rejects(
      library.command({ type: "delete", id }, repository),
      /仍被项目引用/,
    );
    await library.command(
      { type: "unreference", id, project_id: p.id, object_id },
      repository,
    );
    await library.command({ type: "delete", id }, repository);
    assert.equal((await library.list()).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("S7-13 规则 ID 程序创建与编号定位；语言/画幅/规则/声音/默认服装不追溯过期", async () => {
  const home = await mkdtemp(join(tmpdir(), "meiji-config-"));
  let runtime;
  try {
    runtime = await createAppRuntime({ home });
    const p = projectFixture(),
      sid = `session-${randomUUID()}`;
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
        声音: "旧声音",
        必出: true,
        默认服装编号: "C01-01",
        服装: [
          { 编号: "C01-01", 名称: "白衣", 描述: "白色" },
          { 编号: "C01-02", 名称: "黑衣", 描述: "黑色" },
        ],
      },
    ]).characters;
    const c = p.角色库.角色[0];
    c.图片 = { 状态: "generated", 原因: "", 地址: "original.png" };
    for (const co of c.服装)
      co.图片 = { 状态: "generated", 原因: "", 地址: "costume.png" };
    const model = await runtime.repository.create(p);
    await runtime.bindings.bind(sid, p.id);
    await runtime.projectCommand(
      {
        type: "edit",
        project_id: p.id,
        request_id: "settings",
        fields: {
          输出语言: "en",
          画幅: "768x1344",
          规则: [
            {
              范围: "node",
              适用业务: ["seconds"],
              节点编号: "第1集/S01",
              类别: "动作",
              约束: "必须",
              内容: "保持事实",
            },
          ],
        },
      },
      sid,
    );
    await runtime.projectCommand(
      {
        type: "edit-character",
        project_id: p.id,
        request_id: "voice-default",
        target_id: c.id,
        fields: { 声音: "新声音", 默认服装id: c.服装[1].id },
      },
      sid,
    );
    const after = model.read().project;
    assert.match(after.规则[0].id, /^r_/);
    assert.equal(after.规则[0].节点id, p.剧集[0].镜头表.镜头[0].id);
    assert.deepEqual(after.剧集, p.剧集);
    assert.deepEqual(after.角色库.角色[0].图片, c.图片);
    assert.deepEqual(after.角色库.角色[0].服装, c.服装);
    await assert.rejects(
      runtime.projectCommand(
        {
          type: "edit",
          project_id: p.id,
          request_id: "bad-rule",
          fields: {
            规则: [
              {
                范围: "node",
                适用业务: ["seconds"],
                节点编号: "不存在",
                类别: "动作",
                约束: "必须",
                内容: "规则",
              },
            ],
          },
        },
        sid,
      ),
      /不存在/,
    );
  } finally {
    await runtime?.dispose();
    await rm(home, { recursive: true, force: true });
  }
});
