"""Exercise the RunPod readiness check without network or process changes."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1]


class ComfyuiCheckTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        script = self.root / "app/common/check_comfyui.sh"
        script.parent.mkdir(parents=True)
        shutil.copyfile(SOURCE / "app/common/check_comfyui.sh", script)
        self.script = script
        self.log = self.root / "commands.log"
        self.env = dict(os.environ, PATH=f"{self.bin}:{os.environ['PATH']}", CHECK_LOG=str(self.log))
        self.mock("python3", """if [[ \"$1\" == *config_loader.py ]]; then echo COMFYUI_URL=https://pod.test; exit; fi
exec \"$TEST_PYTHON\" \"$@\"""")
        self.env["TEST_PYTHON"] = shutil.which("python3")
        self.mock("curl", """echo \"curl $*\" >> \"$CHECK_LOG\"
if [[ \"$*\" == *userdata* ]]; then
  [[ \"${MISSING_WORKFLOW:-}\" != 1 ]] && count=5 || count=4
  printf '['
  for ((i=1;i<=count;i++)); do [[ $i == 1 ]] || printf ','; printf '{\"path\":\"minimax/%s\"}' \"${NAMES[$i-1]}\"; done
  printf ']'
elif [[ \"$*\" == *object_info* ]]; then
  node=\"${!#}\"; node=\"${node##*/}\"
  [[ \"${MISSING_NODE:-}\" != \"$node\" ]] && printf '{\"%s\":{}}' \"$node\" || printf '{}'
fi""", prefix="NAMES=(MiniMaxH3-Turbo-T2VA-Qwen3.5.json MiniMaxH3-Turbo-I2VA-Qwen3.5.json MiniMaxH3-Turbo-FL2VA-Qwen3.5.json MiniMaxH3-Turbo-FL2VA-Loop-Qwen3.5.json MiniMaxH3-Turbo-R2VA-Qwen3.5.json)")

    def mock(self, name, body, prefix=""):
        path = self.bin / name
        path.write_text("#!/bin/bash\nset -eu\n" + prefix + "\n" + body + "\n")
        path.chmod(0o755)

    def run_check(self):
        return subprocess.run(["bash", str(self.script)], env=self.env, capture_output=True, text=True)

    def test_checks_http_and_exact_five_workflows_without_ssh(self):
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stderr)
        log = self.log.read_text()
        self.assertIn("/system_stats", log)
        self.assertIn("/queue", log)
        self.assertIn("/userdata", log)
        self.assertIn("/object_info/MiniMaxH3ImageToVideo", log)
        self.assertNotIn("AILab_QwenVL", log)
        self.assertNotIn("ssh", log)

    def test_missing_workflow_fails_readiness(self):
        self.env["MISSING_WORKFLOW"] = "1"
        result = self.run_check()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("4/5", result.stderr)

    def test_missing_node_fails_readiness(self):
        self.env["MISSING_NODE"] = "MiniMaxH3ReferenceToVideo"
        result = self.run_check()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("MiniMaxH3ReferenceToVideo", result.stderr)


if __name__ == "__main__":
    unittest.main()
