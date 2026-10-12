import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createAppRuntime } from "../server/runtime/app-runtime.js";
import { createTaskHttpHandler } from "../server/http/task-routes.js";
import { taskTools } from "../tools/task-tools.js";
import { projectFixture } from "./fixtures/project.js";
export async function httpFixture(work) {
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
            ? { 是否通过: true, 原因: "" }
            : { 正文: "新摘要" },
      },
    });
    const p = projectFixture();
    await runtime.repository.create(p);
    await runtime.bindings.bind(sid, p.id);
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

test("S7-01/02 同一真实 HTTP 与会话工具服务，绑定拒绝、通知归属固定", () =>
  httpFixture(async ({ runtime, p, sid, other, post, messages }) => {
    const command = {
      type: "submit",
      project_id: p.id,
      request_id: "api",
      business_type: "project-summary",
      target_id: p.id,
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
          { ...command, request_id: "session-duplicate" },
          { agent: { session: { id: sid } } },
        ),
      );
    assert.equal(result.body.task_id, again.task_id);
    await runtime.tasks.idle(p.id);
    await runtime.notices.drain(p.id);
    assert.ok(
      messages.some((row) => row.data.text.includes("已通过")),
    );
    assert.ok(messages.every((row) => row.id === sid));
    assert.ok(messages.every((row) => row.type === "command/done"));
    assert.ok(!taskTools(runtime).some((t) => t.name.startsWith("run-")));
  }));
test("S7 通知失败仍受理，稳定消息 ID 待投递，重连后去重再投递", () =>
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
              ? { 是否通过: true, 原因: "" }
              : { 正文: "摘要" },
        },
      });
      await r.repository.create(p);
      await r.bindings.bind(sid, p.id);
      const command = {
          type: "submit",
          project_id: p.id,
          request_id: "notify",
          business_type: "project-summary",
          target_id: p.id,
          action: "regenerate",
        },
        result = await r.command(command, sid);
      assert.equal(result.accepted, true);
      assert.ok(result.notification_error);
      await r.tasks.idle(p.id);
      const noticeIds = (await r.repository.open(p.id))
        .read()
        .runtime.outbox.map((n) => n.id);
      available = true;
      await r.notices.drain(p.id);
      await r.notices.drain(p.id);
      assert.deepEqual(ids, noticeIds);
      assert.equal((await r.command(command, sid)).task_id, result.task_id);
      await r.dispose();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }));
test("S7-04 旧端点不再存在，鉴权与同源写入检查保留", () =>
  httpFixture(async ({ base, p, sid }) => {
    assert.equal((await fetch(base + "/api/meiji/projects")).status, 401);
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
