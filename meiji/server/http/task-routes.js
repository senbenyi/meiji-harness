import { SettingsModel } from '../../shared/models/settings_model.js';
import { nodeRules } from './node-rules.js';
import { llmServerClient } from './llm-server/client.js';
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { normalizeModels } from "../../models/model-config.js";
import { redactJson } from "../gateway/redact.js";
import { lightStep, groupSummary, groupDetailRecords, historyPage, historyContext } from "../data/task-store.js";
const clientRoot = fileURLToPath(new URL("../../client/", import.meta.url));
const sharedRoot = fileURLToPath(new URL("../../shared/", import.meta.url));
// 面板刷新只需要步骤状态：复制前去掉提示词与 HTTP，不深拷贝历史记录。
export function panelSnapshot(model, records = new Map()) {
  if (!model) return null;
  return model.select(snapshot => ({
    project: snapshot.project, tasks: snapshot.tasks, groups: snapshot.groups,
    steps: snapshot.steps.map(step => lightStep({ ...step, ...records.get(step.id) })),
    // 幂等结果里含历史组摘要，通知也属于服务端；两者不随面板刷新传输。
    runtime: { revision: snapshot.runtime.revision },
  }));
}
const json = (res, status, value) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
};
async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16 * 1024 * 1024)
      throw Object.assign(new Error("请求过大"), { status: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString() || "{}");
}
export function createTaskHttpHandler(
  runtime,
  { authorize = () => null } = {},
) {
  return async (req, res) => {
    const url = new URL(req.url, "http://localhost"),
      path = url.pathname;
    try {
      if (
        path === "/plugins/meiji/panel.js" ||
        path.startsWith("/plugins/meiji/client/") ||
        path.startsWith("/plugins/meiji/shared/")
      ) {
        if (req.method !== "GET")
          return json(res, 405, { message: "不支持的请求" });
        const shared = path.startsWith("/plugins/meiji/shared/"),
          name =
            path === "/plugins/meiji/panel.js"
              ? "panel.js"
              : path.slice(
                  shared
                    ? "/plugins/meiji/shared/".length
                    : "/plugins/meiji/client/".length,
                );
        if (!(shared ? /^(?:(?:models|prompt-models)\/)?[a-z0-9_-]+\.js$/ : /^[a-z0-9-]+\.(js|css)$/).test(name))
          return json(res, 404, { message: "文件不存在" });
        const bytes = await readFile(
          join(shared ? sharedRoot : clientRoot, name),
        );
        res.writeHead(200, {
          "Content-Type": name.endsWith(".css")
            ? "text/css"
            : "text/javascript",
          "Cache-Control": "no-store",
        });
        return res.end(bytes);
      }
      const rejected = authorize(req);
      if (rejected) return json(res, rejected, { message: "请登录 Harness" });
      if (path.startsWith("/api/meiji/media/")) {
        if (req.method !== "GET")
          return json(res, 405, { message: "不支持的请求" });
        const id = path.split("/")[4];
        await runtime.bindings.require(url.searchParams.get("session_id"), id);
        const bytes = await runtime.media.read(path, id);
        res.writeHead(200, {
          "Content-Type": path.endsWith(".mp4")
            ? "video/mp4"
            : path.endsWith(".jpg")
              ? "image/jpeg"
              : path.endsWith(".webp")
                ? "image/webp"
                : "image/png",
          "Cache-Control": "private, no-cache",
        });
        return res.end(bytes);
      }
      if (req.method === "GET") {
        if (path === "/api/meiji/rules") {
          await runtime.bindings.require(url.searchParams.get('session_id'), url.searchParams.get('project_id'));
          return json(res, 200, nodeRules(url.searchParams.get('business')));
        }
        if (path === "/api/meiji/gpu") {
          const settings = await runtime.models.read();
          return json(res, 200, await llmServerClient.gpu({ baseUrl: settings.textBaseUrl }));
        }
        if (path === "/api/meiji/projects")
          return json(res, 200, { projects: await runtime.repository.list() });
        if (path === "/api/meiji/context") {
          const sid = url.searchParams.get("session_id"),
            id = await runtime.bindings.projectForSession(sid);
          return json(res, 200, {
            session_id: sid,
            project_id: id,
            snapshot: id ? panelSnapshot(await runtime.repository.open(id), runtime.tasks.liveRecords(id)) : null,
          });
        }
        // 任务记录按 ID 从数据库读取（工作快照只含未结束任务）。
        if (["/api/meiji/group", "/api/meiji/records", "/api/meiji/history"].includes(path)) {
          const sid = url.searchParams.get("session_id");
          const projectId = await runtime.bindings.projectForSession(sid);
          if (!projectId) return json(res, 404, { message: "项目不存在" });
          const model = await runtime.repository.open(projectId);
          const { project, revision } = historyContext(model);
          const history = runtime.repository.history(projectId);
          if (path === "/api/meiji/group") {
            const detail = groupDetailRecords(history, runtime.tasks.liveRecords(projectId), url.searchParams.get("group_id"), project, revision);
            if (!detail) return json(res, 404, { message: "任务组不存在" });
            return json(res, 200, detail);
          }
          if (path === "/api/meiji/records") {
            const ids = name => (url.searchParams.get(name) || "").split(",").filter(Boolean).slice(0, 200);
            const groupIds = new Set(ids("group_ids"));
            for (const taskId of ids("task_ids")) {
              const task = history.task(taskId);
              if (task) groupIds.add(task.group_id);
            }
            const groups = [...groupIds].map(id => groupSummary(history.group(id), project)).filter(Boolean);
            return json(res, 200, { revision, groups });
          }
          const number = (name, fallback) => Math.max(0, Number.parseInt(url.searchParams.get(name) || "", 10) || fallback);
          return json(res, 200, { revision, ...historyPage(history, project, {
            status: url.searchParams.get("status") || "", business: url.searchParams.get("business") || "",
            episode: url.searchParams.get("episode") || "", offset: number("offset", 0), limit: Math.min(200, number("limit", 50) || 50),
          }) });
        }
        if (path === "/api/meiji/events") {
          const pid = url.searchParams.get("project_id");
          await runtime.bindings.require(
            url.searchParams.get("session_id"),
            pid,
          );
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          const send = (event) => {
            if (event.project_id === pid)
              res.write(`data: ${JSON.stringify(event)}\n\n`);
          };
          res.write(
            `data: ${JSON.stringify({ project_id: pid, revision: (await runtime.repository.open(pid)).read().runtime.revision })}\n\n`,
          );
          runtime.repository.on("change", send);
          const heartbeat = setInterval(
            () => res.write(": keepalive\n\n"),
            15000,
          );
          req.on("close", () => {
            clearInterval(heartbeat);
            runtime.repository.off("change", send);
          });
          return;
        }
        if (path === "/api/meiji/library")
          return json(res, 200, { assets: await runtime.library.list() });
        if (path.startsWith("/api/meiji/library/")) {
          const asset = await runtime.library.file(
            path.slice("/api/meiji/library/".length),
          );
          res.writeHead(200, {
            "Content-Type": asset.metadata.mime,
            "X-Content-Type-Options": "nosniff",
          });
          return res.end(asset.bytes);
        }
        if (path === "/api/meiji/models") {
          const settings = await runtime.models.read();
          return json(res, 200, { settings: new SettingsModel(settings).toJSON() });
        }
      }
      if (req.method !== "POST")
        return json(res, 404, { message: "端点不存在" });
      if (req.headers["x-meiji-request"] !== "1")
        return json(res, 403, { message: "需要同源请求" });
      if (
        req.headers.origin &&
        req.headers.origin !==
          `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`
      )
        return json(res, 403, { message: "跨站请求已拒绝" });
      const input = await body(req),
        { session_id, command } = input;
      if (path.startsWith('/api/meiji/ai/')) {
        const match = /^\/api\/meiji\/ai\/([a-z]+(?:-[a-z]+)*)\/(generate|review|regenerate)$/.exec(path);
        if (!match) return json(res, 404, { message: 'AI 节点或动作不存在' });
        // 身份上下文通过 query 传入，JSON 正文只包含节点声明的业务参数。
        const sessionId = url.searchParams.get('session_id'), projectId = url.searchParams.get('project_id');
        if (!sessionId || !projectId) return json(res, 403, { message: '需要会话与项目绑定' });
        await runtime.bindings.require(sessionId, projectId);
        const controller = new AbortController();
        const abort = () => controller.abort(new Error('请求连接已关闭'));
        req.once('aborted', abort);
        const close = () => { if (!res.writableEnded) abort(); };
        res.once('close', close);
        try {
          const { result } = await runtime.ai(match[1], match[2], input, { signal: controller.signal });
          return json(res, 200, { result });
        } finally {
          req.off('aborted', abort);
          res.off('close', close);
        }
      }
      if (path === "/api/meiji/library") {
        if (["reference", "unreference"].includes(input.type))
          await runtime.bindings.require(input.session_id, input.project_id);
        return json(
          res,
          200,
          await runtime.library.command(input, runtime.repository),
        );
      }
      if (path === "/api/meiji/task-command")
        return json(
          res,
          200,
          redactJson(await runtime.command(command, session_id, "panel")),
        );
      if (path === "/api/meiji/project-command")
        return json(
          res,
          200,
          await runtime.projectCommand(command, session_id, "panel"),
        );
      if (path === "/api/meiji/models") {
        const settings = await runtime.models.read();
        const selection = new SettingsModel(input.settings).toJSON();
        const value = normalizeModels({ ...settings, ...selection });
        if (runtime.syncModels) await runtime.syncModels(value);
        await runtime.models.write(value);
        return json(res, 200, { saved: true });
      }
      return json(res, 404, { message: "端点不存在" });
    } catch (error) {
      return json(res, error.status || 422, {
        code: error.code || "REQUEST_FAILED",
        message: error.code === "ENOENT" ? "资源不存在" : error.message,
        ...(error.path ? { path: error.path } : {}),
        ...(error.conflicts ? { conflicts: error.conflicts } : {}),
      });
    }
  };
}
export function registerTaskPanel(ctx, runtime) {
  const handler = createTaskHttpHandler(runtime, {
    authorize: (req) => ctx.connection.requestRejection(req),
  });
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "prefix",
        path: "/plugins/meiji",
        handler,
      }),
    "meiji: panel assets",
  );
  ctx.effect(
    () =>
      ctx.webServer.register({ kind: "prefix", path: "/api/meiji", handler }),
    "meiji: task API",
  );
  ctx.on("webserver/index-inject", (rows) =>
    rows.push({
      kind: "script-src",
      placement: "body",
      src: "/plugins/meiji/panel.js",
    }),
  );
}
