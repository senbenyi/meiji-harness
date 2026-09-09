"""Exercise both browser forwards without network access or real process changes."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1]


class HarnessTunnelTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.log = self.root / 'commands.log'
        script = self.root / 'app/common/start_tunnel_harness.sh'
        script.parent.mkdir(parents=True)
        shutil.copyfile(SOURCE / 'app/common/start_tunnel_harness.sh', script)
        self.script = script
        self.env = dict(os.environ, PATH=f'{self.bin}:{os.environ["PATH"]}',
                        TUNNEL_ROOT=str(self.root), TUNNEL_LOG=str(self.log),
                        TEST_PYTHON=sys.executable, PYTHON_BIN=str(self.bin / 'fixture-python'))
        self.mock('fixture-python', '''if [[ "$1" == - ]]; then exec "$TEST_PYTHON" "$@"; fi
cat <<CONFIG
HARNESS_SSH_TARGET=fixture-host
HARNESS_LOCAL_HOST=127.0.0.1
HARNESS_LOCAL_PORT=23080
HARNESS_HOST=127.0.0.1
HARNESS_WEB_PORT=3080
MINIMAX_H3_COMFYUI_PUBLIC_URL=${PUBLIC_URL:-http://127.0.0.1:6016}
MINIMAX_H3_COMFYUI_URL=http://127.0.0.1:6016
CONFIG''')
        self.mock('lsof', '''port=0
for arg in "$@"; do [[ "$arg" != -iTCP:* && "$arg" != -tiTCP:* ]] || port="${arg##*:}"; done
[[ -f "$TUNNEL_ROOT/$port" ]] || exit 1
if [[ "$*" == *"-c ssh"* && "${FOREIGN_PORT:-}" == "$port" ]]; then exit 1; fi
echo 123''')
        self.mock('curl', '''echo "curl $*" >> "$TUNNEL_LOG"
[[ "${FAIL_HTTP:-}" == '' || "$*" != *"$FAIL_HTTP"* ]]''')
        self.mock('ssh', '''echo "ssh $*" >> "$TUNNEL_LOG"
[[ "$*" != *"-O check"* ]] || exit 1
[[ "${FAIL_REMOTE:-}" == '' || "$*" != *"$FAIL_REMOTE"* ]] || exit 9
while [[ $# -gt 0 ]]; do
  if [[ "$1" == -L ]]; then
    shift; forward="$1"; port="${forward#*:}"; port="${port%%:*}"
    touch "$TUNNEL_ROOT/$port"
  fi
  shift
done''')

    def mock(self, name, body):
        path = self.bin / name
        path.write_text('#!/bin/bash\nset -eu\n' + body + '\n')
        path.chmod(0o755)

    def run_tunnel(self):
        return subprocess.run(['bash', str(self.script)], env=self.env, capture_output=True, text=True)

    def test_creates_both_forwards_and_reuses_them(self):
        result = self.run_tunnel()
        self.assertEqual(result.returncode, 0, result.stderr)
        log = self.log.read_text()
        self.assertIn('-L 127.0.0.1:23080:127.0.0.1:3080', log)
        self.assertIn('-L 127.0.0.1:6016:127.0.0.1:6016', log)
        self.log.write_text('')
        result = self.run_tunnel()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn(' -L ', self.log.read_text())

    def test_existing_harness_does_not_skip_missing_comfyui(self):
        (self.root / '23080').touch()
        result = self.run_tunnel()
        self.assertEqual(result.returncode, 0, result.stderr)
        log = self.log.read_text()
        self.assertNotIn('-L 127.0.0.1:23080', log)
        self.assertIn('-L 127.0.0.1:6016', log)

    def test_failed_comfyui_precheck_preserves_harness(self):
        (self.root / '23080').touch()
        self.env['FAIL_REMOTE'] = 'http://127.0.0.1:6016'
        result = self.run_tunnel()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('远端 ComfyUI 未就绪', result.stderr)
        self.assertNotIn('-O exit', self.log.read_text())
        self.assertNotIn(' -L ', self.log.read_text())

    def test_foreign_port_is_not_terminated(self):
        for port in ('23080', '6016'):
            (self.root / port).touch()
        self.env['FOREIGN_PORT'] = '6016'
        result = self.run_tunnel()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('端口 6016 被其他连接或程序占用', result.stderr)
        self.assertNotIn('-O exit', self.log.read_text())

    def test_external_public_url_is_checked_without_forwarding(self):
        self.env['PUBLIC_URL'] = 'https://media.example.test'
        result = self.run_tunnel()
        self.assertEqual(result.returncode, 0, result.stderr)
        log = self.log.read_text()
        self.assertEqual(log.count(' -L '), 1)
        self.assertIn('https://media.example.test', log)


if __name__ == '__main__':
    unittest.main()
