"""Deployment ordering tests; all network, package and tunnel commands are mocked."""
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
        self.env = dict(os.environ, PATH=f"{self.bin}:{os.environ['PATH']}",
                        DEPLOY_TEST_ROOT=str(self.root), DEPLOY_TEST_LOG=str(self.log))
        for name in ("deploy_dsh_elysium_tools.sh", "deploy_dsh_elysium_ui.sh",
                     "common/deploy_plugin.sh"):
            dest = self.root / "scripts" / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(SOURCE / "scripts" / name, dest)
        for name in ("config/harness-settings.yaml", "config/harness-agent.md",
                     "config/system-prompt.yaml", "config/ssh_config",
                     "scripts/common/config_loader.py", "scripts/common/install_plugin.sh",
                     "scripts/common/start_harness.sh", "scripts/common/start_tunnel_qwen.sh",
                     "dsh-elysium-ui/package.json", "dsh-elysium-tools/package.json"):
            file = self.root / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text("fixture\n")
        (self.root / ".dsh").mkdir()
        (self.root / "scripts/common/start_tunnel_harness.sh").write_text(
            'echo "tunnel $PYTHON_BIN" >> "$DEPLOY_TEST_LOG"\n')
        self.mock("git", 'echo "$DEPLOY_TEST_ROOT"')
        self.mock("fixture-python", "printf '%s\\n' HARNESS_ROOT=/remote/harness PLUGINS_ROOT=/remote/plugins HARNESS_LOCAL_PORT=23080")
        self.env["PYTHON_BIN"] = str(self.bin / "fixture-python")
        for command in ("ssh", "rsync", "pnpm"):
            self.mock(command, f'echo "{command} $PWD $*" >> "$DEPLOY_TEST_LOG"\n'
                      'if [[ "${FAIL_COMMAND:-}" == "$(basename "$0") $1" ]]; then exit 9; fi\n'
                      'exit 0')

    def mock(self, name, body):
        file = self.bin / name
        file.write_text("#!/bin/bash\nset -eu\n" + body + "\n")
        file.chmod(0o755)

    def run_deploy(self, kind, *args):
        return subprocess.run(["bash", str(self.root / f"scripts/deploy_dsh_elysium_{kind}.sh"), *args],
                              env=self.env, capture_output=True, text=True)

    def test_both_entries_build_before_upload_and_preserve_remote_dependencies(self):
        for kind in ("tools", "ui"):
            with self.subTest(kind=kind):
                self.log.write_text("")
                result = self.run_deploy(kind)
                self.assertEqual(result.returncode, 0, result.stderr)
                log = self.log.read_text()
                self.assertLess(log.index(" package:registry"), log.index("rsync "))
                self.assertIn(f"pnpm {self.root}/dsh-elysium-{kind} test", log)
                self.assertIn(f"/remote/harness/packages/dsh-elysium-{kind}-registry/", log)
                self.assertIn("--exclude=node_modules", log)
                self.assertIn(f"install_plugin.sh '{kind}' --prepare", log)
                self.assertIn(f"tunnel {self.env['PYTHON_BIN']}", log)

    def test_failed_tests_prevent_build_upload_and_restart(self):
        self.env["FAIL_COMMAND"] = "pnpm test"
        result = self.run_deploy("ui")
        self.assertNotEqual(result.returncode, 0)
        log = self.log.read_text()
        self.assertNotIn(" build", log)
        self.assertNotIn("rsync ", log)
        self.assertNotIn("install_plugin.sh", log)
        self.assertNotIn("tunnel ", log)

    def test_extra_arguments_fail_before_external_commands(self):
        result = self.run_deploy("ui", "--unexpected")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.log.exists())


if __name__ == "__main__":
    unittest.main()
