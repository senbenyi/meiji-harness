import { homedir } from "node:os";
import { join } from "node:path";
import { createAppRuntime } from "./server/runtime/app-runtime.js";
import { registerTaskPanel } from "./server/http/task-routes.js";
import { syncChatModel } from "./server/host/harness-chat-model.js";
import { ffmpegAvailable } from "./server/media/check-ffmpeg.js";
export const name = "meiji";
export const inject = [
  "webServer",
  "connection",
  "settings",
  "credentials",
  "sessionController",
  "workspaceController",
];
export async function apply(ctx) {
  const home = process.env.DSH_HOME || join(homedir(), ".dsh");
  const runtime = await createAppRuntime({
    home,
    sessionController: ctx.sessionController,
    workspaceController: ctx.workspaceController,
  });
  runtime.ready = Promise.resolve();
  ctx.provide("meiji", runtime);
  runtime.syncModels = (routes) => syncChatModel(ctx, routes);
  // 设置变更在服务公布后处理，避免 Loader 等待依赖服务的循环。
  void runtime.models
    .read()
    .then(async (routes) => {
      await syncChatModel(ctx, routes);
    })
    .catch((error) =>
      ctx.logger.warn("Meiji chat settings: %s", error.message),
    );
  if (!(await ffmpegAvailable()))
    ctx.logger.warn("Meiji: FFmpeg 不可用，媒体步骤会报告失败");
  registerTaskPanel(ctx, runtime);
  ctx.on("agent/created", () => {
    void runtime.repository
      .list()
      .then(async (entries) => {
        for (const entry of entries)
          if (!entry.unsupported) await runtime.notices.drain(entry.id);
      })
      .catch((error) =>
        ctx.logger.warn("Meiji notification recovery: %s", error.message),
      );
  });
  ctx.effect(() => () => runtime.dispose(), "meiji: task runtime");
}
