import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

test("S8-08 双端可达模块与全部源码无旧控制依赖；R1–R13 文件退出", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url)),
    queue = ["index.js", "session.js", "client/workbench.js"],
    seen = new Set();
  while (queue.length) {
    const path = queue.pop();
    if (seen.has(path)) continue;
    seen.add(path);
    const url = new URL(path, new URL("../", import.meta.url)),
      source = await readFile(url, "utf8");
    for (const spec of [
      ...source.matchAll(/(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g),
    ].map((m) => m[1]))
      if (spec.startsWith(".")) {
        const target = fileURLToPath(new URL(spec, url));
        assert.ok(target.startsWith(root));
        queue.push(target.slice(root.length));
      }
  }
  for (const path of seen)
    assert.ok(
      !/server\/(models|flow\/runs|flow\/operations)|shared\/(run-planner|run-templates|pipeline-cascade)|skills\/(task|review)|client\/(goal-request|run-preview|run-edit-choice)/.test(
        path,
      ),
      path,
    );
  const scan = async (dir) => {
    for (const name of await readdir(dir, { withFileTypes: true })) {
      if (
        name.name === "node_modules" ||
        name.name === "tests" ||
        name.name === "dev_docs"
      )
        continue;
      const path = join(dir, name.name);
      if (name.isDirectory()) await scan(path);
      else if (name.name.endsWith(".js")) {
        const source = await readFile(path, "utf8");
        for (const spec of [
          ...source.matchAll(/(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g),
        ].map((m) => m[1]))
          if (spec.startsWith("."))
            await readFile(new URL(spec, new URL("file://" + path)), "utf8");
      }
    }
  };
  await scan(root);
  await import("../index.js");
  await import("../session.js");
  for (const old of [
    "server/data/run-store.js",
    "server/models/data/drama-model.js",
    "server/flow/runs/run-service.js",
    "server/flow/immediate-service.js",
    "server/host/harness-run-jobs.js",
    "server/host/harness-run-goals.js",
    "client/goal-request.js",
  ])
    await assert.rejects(readFile(join(root, old)), { code: "ENOENT" });
  const scripts = await readdir(join(root, "scripts"));
  // 旧项目迁移仍退出；这次只新增独立模型配置的显式迁移。
  assert.deepEqual(scripts.filter((name) => name.startsWith("migrate-")), ["migrate-qwen-models.js"]);
  assert.ok(!seen.has("scripts/migrate-qwen-models.js"));
});
