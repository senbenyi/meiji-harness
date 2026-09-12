"""Local plugin deployment tests; external commands are mocked."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1]


class DeployPluginTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.log = self.root / "commands.log"
        script = self.root / "app/common/deploy_plugin.sh"
        script.parent.mkdir(parents=True)
        shutil.copyfile(SOURCE / "app/common/deploy_plugin.sh", script)
        for name in ("harness/config/settings.yaml", "app/common/config_loader.py",
                     "app/common/start_harness.sh",
                     "dsh-elysium-tools/package.json"):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("fixture\n")
        (self.root / "app/common/start_harness.sh").write_text('echo start_harness.sh >> "$DEPLOY_TEST_LOG"\n')
        self.mock("python3", "printf '%s\\n' LOCAL_DSH_HOME=$DEPLOY_TEST_ROOT/home LOCAL_HARNESS_HOST=127.0.0.1 LOCAL_HARNESS_PORT=3080")
        self.mock("node", 'exit 0')
        self.mock("pnpm", 'echo "pnpm $PWD $*" >> "$DEPLOY_TEST_LOG"; [[ "${FAIL_TESTS:-}" != 1 || "$1" != test ]]')
        self.mock("dsh", '''echo "dsh $*" >> "$DEPLOY_TEST_LOG"
mkdir -p "$DEPLOY_TEST_ROOT/home/profiles/web"
printf '%s' '{"dependencies":{"@dsh-external/dsh-elysium-tools":"link:x"},"dsh":{"profile":{"bundles":["@dsh-external/dsh-elysium-tools"]}}}' > "$DEPLOY_TEST_ROOT/home/profiles/web/package.json"''')
        for name in ("lsof", "ps", "curl"):
            self.mock(name, "exit 0")
        self.env = dict(os.environ, PATH=f"{self.bin}:{os.environ['PATH']}",
                        DEPLOY_TEST_ROOT=str(self.root), DEPLOY_TEST_LOG=str(self.log))
        (self.root / "home").mkdir()
        base = self.root / "harness/.agent-presets/_base"
        base.mkdir(parents=True)
        (base / "agent.cordis.yml").write_text("shared config\n")
        for preset in ("elysium-standard", "elysium-teaching", "elysium-free", "elysium-director"):
            (self.root / f"harness/.agent-presets/{preset}").mkdir(parents=True, exist_ok=True)
            (self.root / f"home/.agent-presets/{preset}").mkdir(parents=True, exist_ok=True)

    def mock(self, name, body):
        path = self.bin / name
        path.write_text("#!/bin/bash\nset -eu\n" + body + "\n")
        path.chmod(0o755)

    def run_deploy(self, kind, *args):
        return subprocess.run(["bash", str(self.root / "app/common/deploy_plugin.sh"), kind, *args],
                              env=self.env, capture_output=True, text=True)

    def test_tools_plugin_build_register_locally_and_restart_local_harness(self):
        for kind in ("tools",):
            with self.subTest(kind=kind):
                self.log.write_text("")
                result = self.run_deploy(kind)
                self.assertEqual(result.returncode, 0, result.stderr)
                log = self.log.read_text()
                self.assertIn(f"pnpm {self.root}/dsh-elysium-{kind} test", log)
                self.assertIn(f"--workspace-root {self.root}/dsh-elysium-{kind}/registry", log)
                self.assertNotIn("ssh ", log)
                self.assertNotIn("rsync ", log)

    def test_failed_tests_prevent_build_registration(self):
        self.env["FAIL_TESTS"] = "1"
        result = self.run_deploy("tools")
        self.assertNotEqual(result.returncode, 0)
        log = self.log.read_text()
        self.assertNotIn(" build", log)
        self.assertNotIn("dsh plugin", log)

    def test_new_presets_keep_resolvable_shared_config_and_existing_presets(self):
        for preset in ("elysium-teaching", "elysium-free", "elysium-director"):
            (self.root / f"home/.agent-presets/{preset}").rmdir()
            (self.root / f"harness/.agent-presets/{preset}/agent.cordis.yml").symlink_to("../_base/agent.cordis.yml")
        existing = self.root / "home/.agent-presets/elysium-standard/agent.cordis.yml"
        existing.write_text("local config\n")
        result = self.run_deploy("tools")
        self.assertEqual(result.returncode, 0, result.stderr)
        for preset in ("elysium-teaching", "elysium-free", "elysium-director"):
            config = self.root / f"home/.agent-presets/{preset}/agent.cordis.yml"
            self.assertTrue(config.is_symlink())
            self.assertEqual(config.read_text(), "shared config\n")
        self.assertEqual(existing.read_text(), "local config\n")

    def test_extra_arguments_fail_before_external_commands(self):
        result = self.run_deploy("tools", "--unexpected")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.log.exists())


if __name__ == "__main__":
    unittest.main()
