import contextlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("config_loader", ROOT / "app/common/config_loader.py")
loader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(loader)


class HarnessSettingsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.config = ROOT / "app/config/harness-settings.yaml"

    def output(self, mode, config=None):
        stream = io.StringIO()
        with contextlib.redirect_stdout(stream):
            loader.write_harness_settings(mode, config or self.config)
        return stream.getvalue()

    def test_shell_exports_local_harness_and_remote_model_tunnels(self):
        output = self.output("shell")
        for key in ("LOCAL_DSH_HOME", "LOCAL_HARNESS_PORT", "COMFYUI_SSH_TARGET", "QWEN_SSH_TARGET"):
            self.assertIn(key + "=", output)
        for key in ("HARNESS_ROOT", "HARNESS_SSH_TARGET", "HARNESS_LOCAL_PORT", "PLUGINS_ROOT", "PROJECT_ROOT"):
            self.assertNotIn(key + "=", output)

    def test_render_targets_local_qwen_and_removes_runtime_sections(self):
        output = self.output("render")
        self.assertIn("http://127.0.0.1:18000/v1", output)
        self.assertNotIn("harness-runtime", output)
        self.assertNotIn("harness-customization", output)

    def test_required_http_and_local_values_are_validated(self):
        data = yaml.safe_load(self.config.read_text())
        for key in ("MINIMAX_H3_COMFYUI_URL", "LOCAL_HARNESS_PORT", "LOCAL_DSH_HOME"):
            broken = yaml.safe_load(yaml.safe_dump(data))
            broken["harness-runtime"][key] = ""
            path = self.root / f"{key}.yaml"
            path.write_text(yaml.safe_dump(broken))
            with self.assertRaises(ValueError):
                loader.write_harness_settings("shell", path)


if __name__ == "__main__":
    unittest.main()
