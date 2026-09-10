import os
from pathlib import Path
import subprocess
import tempfile
import unittest


REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "app/common/start_tunnel_qwen.sh"


class QwenTunnelTests(unittest.TestCase):
    def test_pretty_model_json_reuses_healthy_tunnel(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            settings = "\n".join((
                "QWEN_LOCAL_HOST=127.0.0.1", "QWEN_API_LOCAL_PORT=18000",
                "QWEN_REMOTE_HOST=127.0.0.1", "QWEN_API_REMOTE_PORT=8000",
                "QWEN_MODEL_ID=target-model", "QWEN_SSH_TARGET=fixture",
            ))
            python = root / "python"
            python.write_text(f"#!/bin/sh\ncase \"$1\" in *config_loader.py) cat <<'EOF'\n{settings}\nEOF\n;; *) exec /usr/bin/python3 \"$@\";; esac\n")
            commands = {
                "curl": "printf '%s\\n' '{\"data\": [{\"id\": \"other\"}, {\"id\": \"target-model\"}]}'\n",
                "lsof": "printf '42\\n'\n",
                "ps": "printf '%s\\n' 'ssh -L 127.0.0.1:18000:127.0.0.1:8000 fixture'\n",
                "ssh": "exit 99\n",
            }
            for name, body in commands.items():
                path = root / name
                path.write_text("#!/bin/sh\n" + body)
                path.chmod(0o755)
            python.chmod(0o755)
            env = dict(os.environ, PATH=f"{root}:{os.environ['PATH']}", PYTHON_BIN=str(python))
            result = subprocess.run(["bash", str(SCRIPT)], env=env, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("[REUSE]", result.stdout)


if __name__ == "__main__":
    unittest.main()
