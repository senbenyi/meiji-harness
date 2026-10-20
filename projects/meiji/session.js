import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { taskTools } from "./tools/task-tools.js";
export const name = "meiji-session";
export const inject = ["meiji", "tools", "skills"];
export async function apply(ctx) {
  const runtime = ctx.meiji;
  await runtime.ready;
  for (const tool of taskTools(runtime))
    ctx.effect(() => ctx.tools.register(tool), `meiji session: ${tool.name}`);
  const path = new URL("./skills/session/panel.md", import.meta.url),
    content = await readFile(path, "utf8");
  const skill = {
    name: "meiji-workflow",
    description: "项目、节点任务、组合任务及程序通知的使用边界",
    category: "gongyong",
    pane: null,
    feature: "panel",
    mode: "generate",
    source: "runtime",
    content,
    path: fileURLToPath(path),
    resourceBase: { kind: "opaque", description: "正文已注入会话" },
  };
  ctx.effect(() => ctx.skills.register(skill), "meiji session: workflow");
}
