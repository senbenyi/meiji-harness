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
        dest = self.root / "app/common/deploy_plugin.sh"
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(SOURCE / "app/common/deploy_plugin.sh", dest)
        for name in ("app/config/harness-settings.yaml",
                     "app/common/config_loader.py", "app/common/install_plugin.sh",
                     "app/common/start_harness.sh", "app/common/start_tunnel_qwen.sh",
                     "dsh-elysium-ui/package.json", "dsh-elysium-tools/package.json"):
            file = self.root / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text("fixture\n")
        (self.root / "app/common/start_tunnel_harness.sh").write_text(
            'echo "tunnel $PYTHON_BIN" >> "$DEPLOY_TEST_LOG"\n')
        self.mock("git", 'echo "$DEPLOY_TEST_ROOT"')
        self.mock("fixture-python", "printf '%s\\n' HARNESS_ROOT=/remote/harness PLUGINS_ROOT=/remote/plugins HARNESS_LOCAL_PORT=23080 HARNESS_LOCAL_HOST=localhost HARNESS_SSH_TARGET=fixture-host HARNESS_PYTHON=/configured/python")
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
        return subprocess.run(["bash", str(self.root / "app/common/deploy_plugin.sh"), kind, *args],
                              env=self.env, capture_output=True, text=True)

    def test_both_kinds_build_before_upload_and_preserve_remote_dependencies(self):
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
                self.assertIn(f"{self.root}/app fixture-host:/remote/plugins/", log)
                self.assertNotIn(f"{self.root}/config", log)
                self.assertNotIn(f"{self.root}/.dsh", log)
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

    def prepare_installer(self):
        shutil.copyfile(SOURCE / 'app/common/install_plugin.sh', self.root / 'app/common/install_plugin.sh')
        harness = self.root / 'harness'
        runtime = harness / 'runtime/node-v24.20.0-linux-x64/bin'
        runtime.mkdir(parents=True)
        (runtime / 'node').symlink_to(shutil.which('node'))
        self.mock('fixture-python', f"printf '%s\\n' HARNESS_ROOT={harness} HARNESS_PYTHON={self.bin / 'fixture-python'} HARNESS_HOST=localhost HARNESS_WEB_PORT=3080")
        host_modules = harness / 'app/node_modules'
        (host_modules / '.bin').mkdir(parents=True)
        dsh = host_modules / '.bin/dsh'
        dsh.write_text('#!/bin/bash\necho registered >> "$DEPLOY_TEST_LOG"\nexit 7\n')
        dsh.chmod(0o755)
        plugin = harness / 'packages/dsh-elysium-ui-registry'
        (plugin / 'lib').mkdir(parents=True)
        (plugin / 'node_modules').symlink_to(host_modules)
        (plugin / 'package.json').write_text('{"type":"module","dependencies":{"schemastery":"3.18.0"}}')
        (plugin / 'lib/index.js').write_text('import "schemastery";')
        (plugin / 'lib/client.js').write_text('// browser fixture')
        return plugin, host_modules

    def run_installer(self):
        return subprocess.run(['bash', str(self.root / 'app/common/install_plugin.sh'), 'ui'],
                              env=self.env, capture_output=True, text=True)

    def test_installer_removes_only_old_link_and_requires_lock(self):
        plugin, host_modules = self.prepare_installer()
        result = self.run_installer()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('pnpm-lock.yaml', result.stderr)
        self.assertTrue(host_modules.is_dir())
        self.assertFalse((plugin / 'node_modules').exists())
        self.assertFalse(self.log.exists())

    def test_dependency_install_failure_prevents_registration(self):
        plugin, _ = self.prepare_installer()
        (plugin / 'pnpm-lock.yaml').write_text('fixture')
        self.env['FAIL_COMMAND'] = 'pnpm install'
        result = self.run_installer()
        self.assertEqual(result.returncode, 9, result.stderr)
        log = self.log.read_text()
        self.assertIn('install --prod --frozen-lockfile --ignore-scripts', log)
        self.assertNotIn('registered', log)

    def test_installed_dependency_resolves_before_registration(self):
        plugin, host_modules = self.prepare_installer()
        (plugin / 'pnpm-lock.yaml').write_text('fixture')
        self.mock('pnpm', '''mkdir -p node_modules/schemastery
printf '%s' '{"name":"schemastery","main":"index.js"}' > node_modules/schemastery/package.json
echo 'module.exports = {}' > node_modules/schemastery/index.js''')
        result = self.run_installer()
        # Mock registration stops with 7, so no actual restart is attempted.
        self.assertEqual(result.returncode, 7, result.stderr)
        self.assertIn('registered', self.log.read_text())
        self.assertFalse((plugin / 'node_modules').is_symlink())
        self.assertFalse((host_modules / 'schemastery').exists())

    def test_dependency_download_does_not_inherit_dead_proxy(self):
        plugin, _ = self.prepare_installer()
        (plugin / 'pnpm-lock.yaml').write_text('fixture')
        for key in ('http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY',
                    'npm_config_proxy', 'npm_config_https_proxy', 'NPM_CONFIG_PROXY', 'NPM_CONFIG_HTTPS_PROXY'):
            self.env[key] = 'http://127.0.0.1:7890'
        self.mock('pnpm', '''
for key in http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY npm_config_proxy npm_config_https_proxy NPM_CONFIG_PROXY NPM_CONFIG_HTTPS_PROXY; do
  [[ -z "${!key:-}" ]] || exit 99
done
[[ "$NO_PROXY" == '*' && "$no_proxy" == '*' ]] || exit 98
exit 9''')
        result = self.run_installer()
        self.assertEqual(result.returncode, 9, result.stderr)
        self.assertFalse(self.log.exists())


if __name__ == "__main__":
    unittest.main()
