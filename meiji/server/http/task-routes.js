import { SettingsModel } from '../../shared/models/settings_model.js';
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { normalizeModels } from "../../models/model-config.js";
import { redactJson } from "../gateway/redact.js";
const clientRoot = fileURLToPath(new URL("../../client/", import.meta.url));
const sharedRoot = fileURLToPath(new URL("../../shared/", import.meta.url));
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
        if (!(shared ? /^(?:models\/)?[a-z0-9_-]+\.js$/ : /^[a-z0-9-]+\.(js|css)$/).test(name))
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
        if (path === "/api/meiji/projects")
          return json(res, 200, { projects: await runtime.repository.list() });
        if (path === "/api/meiji/context") {
          const sid = url.searchParams.get("session_id"),
            id = await runtime.bindings.projectForSession(sid);
          return json(res, 200, {
            session_id: sid,
            project_id: id,
            snapshot: id ? (await runtime.repository.open(id)).read() : null,
          });
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
