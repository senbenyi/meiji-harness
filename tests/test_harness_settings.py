import importlib.util
from pathlib import Path
import tempfile
import subprocess
import sys
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

    def test_runtime_addresses_are_required_and_render_custom_hosts(self):
        import contextlib
        import io
        data = yaml.safe_load(self.config.read_text())
        config = self.root / "settings.yaml"
        for key in ("MINIMAX_H3_COMFYUI_URL", "HARNESS_LOCAL_PORT", "ARTIFACTS_ROOT"):
            original = data["harness-runtime"].pop(key)
            config.write_text(yaml.safe_dump(data))
            with self.assertRaises(KeyError):
                loader.write_harness_settings("shell", config)
            data["harness-runtime"][key] = ""
            config.write_text(yaml.safe_dump(data))
            with self.assertRaises(ValueError):
                loader.write_harness_settings("shell", config)
            data["harness-runtime"][key] = original
        data["harness-runtime"]["QWEN_LOCAL_HOST"] = "qwen.test"
        data["harness-runtime"]["QWEN_API_LOCAL_PORT"] = 19800
        data["harness-runtime"]["PLUGINS_ROOT"] = "/configured/plugins"
        config.write_text(yaml.safe_dump(data))
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            loader.write_harness_settings("render", config)
        self.assertIn("http://qwen.test:19800/v1", output.getvalue())
        files = loader.harness_files(config, self.root)
        self.assertNotIn("__PLUGINS_ROOT__", "\n".join(files.values()))

    def test_apply_replaces_configuration_and_preserves_session_data(self):
        home = self.root / "home"
        home.mkdir()
        settings = home / "settings.yaml"
        settings.write_text("obsolete: true\n")
        session = home / "session.jsonl"
        session.write_text("unchanged")
        loader.apply_harness(self.config, self.root)
        self.assertEqual(settings.with_suffix('.yaml.previous').read_text(), "obsolete: true\n")
        actual = yaml.safe_load(settings.read_text())
        self.assertNotIn("obsolete", actual)
        self.assertNotIn("harness-customization", actual)
        self.assertNotIn("harness-runtime", actual)
        self.assertNotIn("__QWEN_", settings.read_text())
        self.assertEqual(session.read_text(), "unchanged")
        self.assertFalse((home / "AGENTS.md").exists())
        self.assertFalse((home / ".agent-presets").exists())
        profile = yaml.safe_load((home / "profiles/web/cordis.patch.yml").read_text())
        plugin = next(row["config"] for row in profile if row.get("id") == "dsh-elysium-tools")
        runtime = yaml.safe_load(self.config.read_text())["harness-runtime"]
        self.assertEqual(plugin["comfyUrl"], runtime["MINIMAX_H3_COMFYUI_URL"])
        self.assertEqual(plugin["artifactsRoot"], runtime["ARTIFACTS_ROOT"])
        self.assertEqual(plugin["python"], runtime["HARNESS_PYTHON"])
        self.assertNotIn("__", str(plugin))
        self.assertFalse(any(row.get("id") == "system-prompt" for row in profile))
        expected = {p: p.read_bytes() for p in loader.harness_files(self.config, self.root)}
        loader.apply_harness(self.config, self.root)
        self.assertEqual(expected, {p: p.read_bytes() for p in expected})

    def test_check_does_not_write(self):
        loader.apply_harness(self.config, self.root, check=True)
        self.assertFalse((self.root / "home").exists())

    def test_default_config_path_from_other_working_directory(self):
        subprocess.run([sys.executable, str(ROOT / "app/common/config_loader.py"),
                        "check", "--harness-root", str(self.root)],
                       cwd=self.root, check=True, stdout=subprocess.DEVNULL)
        self.assertFalse((self.root / "home").exists())

    def test_invalid_profile_fails_before_any_write(self):
        data = yaml.safe_load(self.config.read_text())
        data["harness-customization"]["profile"] = "invalid"
        config = self.root / "invalid.yaml"
        config.write_text(yaml.safe_dump(data))
        with self.assertRaises(ValueError):
            loader.apply_harness(config, self.root)
        self.assertFalse((self.root / "home").exists())

    def test_deploy_preserves_user_instructions_and_presets(self):
        home = self.root / "home"
        preset = home / ".agent-presets/elysium/agent.cordis.yml"
        preset.parent.mkdir(parents=True)
        preset.write_text("user preset")
        (home / "AGENTS.md").write_text("user instructions")
        loader.apply_harness(self.config, self.root)
        self.assertEqual(preset.read_text(), "user preset")
        self.assertEqual((home / "AGENTS.md").read_text(), "user instructions")


if __name__ == "__main__":
    unittest.main()
