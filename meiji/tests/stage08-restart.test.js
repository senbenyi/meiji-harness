import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
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
  test(`S8-04 restart-harness ${mode}：旧进程退出后才能启动`, async () => {
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
