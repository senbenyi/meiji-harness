"""Exercise the ComfyUI-only tunnel without network or process changes."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1]


class ComfyuiTunnelTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.log = self.root / "commands.log"
        script = self.root / "app/common/start_tunnel_comfyui.sh"
        script.parent.mkdir(parents=True)
        shutil.copyfile(SOURCE / "app/common/start_tunnel_comfyui.sh", script)
        self.script = script
        self.env = dict(os.environ, PATH=f"{self.bin}:{os.environ['PATH']}", TUNNEL_ROOT=str(self.root),
                        TUNNEL_LOG=str(self.log), TEST_PYTHON=sys.executable,
                        PYTHON_BIN=str(self.bin / "fixture-python"))
        self.mock("fixture-python", '''if [[ "$1" == - ]]; then exec "$TEST_PYTHON" "$@"; fi
cat <<CONFIG
COMFYUI_SSH_TARGET=fixture-host
MINIMAX_H3_COMFYUI_PUBLIC_URL=${PUBLIC_URL:-http://127.0.0.1:6016}
MINIMAX_H3_COMFYUI_URL=http://127.0.0.1:6016
CONFIG''')
        self.mock("lsof", '''[[ -f "$TUNNEL_ROOT/6016" ]] || exit 1
if [[ "$*" == *"-c ssh"* && "${FOREIGN_PORT:-}" == 1 ]]; then exit 1; fi
echo 123''')
        self.mock("curl", 'echo "curl $*" >> "$TUNNEL_LOG"; [[ "${FAIL_HTTP:-}" != 1 ]]')
        self.mock("ssh", '''echo "ssh $*" >> "$TUNNEL_LOG"
[[ "$*" != *"-O check"* ]] || exit 1
[[ "${FAIL_REMOTE:-}" != 1 || "$*" != *"curl -fsS"* ]] || exit 9
while [[ $# -gt 0 ]]; do
  if [[ "$1" == -L ]]; then touch "$TUNNEL_ROOT/6016"; fi
  shift
done''')

    def mock(self, name, body):
        path = self.bin / name
        path.write_text("#!/bin/bash\nset -eu\n" + body + "\n")
        path.chmod(0o755)

    def run_tunnel(self):
        return subprocess.run(["bash", str(self.script)], env=self.env, capture_output=True, text=True)

    def test_creates_only_comfyui_forward_and_reuses_it(self):
        result = self.run_tunnel()
        self.assertEqual(result.returncode, 0, result.stderr)
        log = self.log.read_text()
        self.assertIn("-L 127.0.0.1:6016:127.0.0.1:6016", log)
        self.assertNotIn("23080", log)
        self.log.write_text("")
        result = self.run_tunnel()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn(" -L ", self.log.read_text())

    def test_failed_remote_precheck_does_not_replace_tunnel(self):
        (self.root / "6016").touch()
        self.env["FAIL_REMOTE"] = "1"
        result = self.run_tunnel()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("远端 ComfyUI 未就绪", result.stderr)
        self.assertNotIn("-O exit", self.log.read_text())

    def test_foreign_listener_is_not_terminated(self):
        (self.root / "6016").touch()
        self.env["FAIL_HTTP"] = "1"
        self.env["FOREIGN_PORT"] = "1"
        result = self.run_tunnel()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("端口 6016 被其他连接或程序占用", result.stderr)
        self.assertNotIn("-O exit", self.log.read_text())

    def test_public_url_is_checked_without_ssh(self):
        self.env["PUBLIC_URL"] = "https://comfy.example.test"
        result = self.run_tunnel()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("公网地址已可用", result.stdout)
        self.assertNotIn("ssh ", self.log.read_text())


if __name__ == "__main__":
    unittest.main()
