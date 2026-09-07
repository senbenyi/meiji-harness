import importlib.util
from pathlib import Path
import tempfile
import subprocess
import sys
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("config_loader", ROOT / "scripts/common/config_loader.py")
loader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(loader)


class HarnessSettingsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.config = ROOT / "config/harness-settings.yaml"
        source = self.root / "app/node_modules/@deepseek-ai/dsh/config/agent-presets/standard/agent.cordis.yml"
        source.parent.mkdir(parents=True)
        source.write_text("""- id: persona
  name: '@deepseek-ai/dsh-persona'
  config: {text: old}
- id: agent-instructions
  name: '@deepseek-ai/dsh-agent-instructions'
  config: {maxBytes: 1}
- id: shell
  name: '@deepseek-ai/dsh-tool-bash'
  disabled: !!js process.platform === 'win32'
- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
""")

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
        self.assertEqual((home / "AGENTS.md").read_text(), (ROOT / "config/harness-agent.md").read_text())
        profile = yaml.safe_load((home / "profiles/web/cordis.patch.yml").read_text())
        prompt = next(row["config"] for row in profile if row.get("id") == "system-prompt")
        self.assertEqual(prompt, yaml.safe_load((ROOT / "config/system-prompt.yaml").read_text()))
        preset = home / ".agent-presets/elysium/agent.cordis.yml"
        tree = yaml.compose(preset.read_text())
        self.assertEqual(dict((k.value, v.value) for k, v in tree.value[0].value)["disabled"], "true")
        self.assertEqual(dict((k.value, v.tag) for k, v in tree.value[2].value)["disabled"], "tag:yaml.org,2002:js")
        source = self.root / "app/node_modules/@deepseek-ai/dsh/config/agent-presets/standard/agent.cordis.yml"
        original = yaml.compose(source.read_text())
        for index in (1, 2):
            self.assertEqual(yaml.serialize(tree.value[index]), yaml.serialize(original.value[index]))
        metadata = yaml.safe_load((preset.parent / "preset.yml").read_text())
        self.assertEqual(metadata, yaml.safe_load(self.config.read_text())["harness-customization"]["agent"]["metadata"])
        expected = {p: p.read_bytes() for p in loader.harness_files(self.config, self.root)}
        loader.apply_harness(self.config, self.root)
        self.assertEqual(expected, {p: p.read_bytes() for p in expected})

    def test_check_does_not_write(self):
        loader.apply_harness(self.config, self.root, check=True)
        self.assertFalse((self.root / "home").exists())

    def test_default_config_path_from_other_working_directory(self):
        subprocess.run([sys.executable, str(ROOT / "scripts/common/config_loader.py"),
                        "check", "--harness-root", str(self.root)],
                       cwd=self.root, check=True, stdout=subprocess.DEVNULL)
        self.assertFalse((self.root / "home").exists())

    def test_missing_source_fails_before_any_write(self):
        data = yaml.safe_load(self.config.read_text())
        for key in ("instructionsFile", "systemPromptFile"):
            with self.subTest(key=key):
                custom = data["harness-customization"]
                for source in ("instructionsFile", "systemPromptFile"):
                    custom[source] = str(ROOT / "config" / ("harness-agent.md" if source == "instructionsFile" else "system-prompt.yaml"))
                custom[key] = "missing-file"
                config = self.root / "settings.yaml"
                config.write_text(yaml.safe_dump(data))
                with self.assertRaises(FileNotFoundError):
                    loader.apply_harness(config, self.root)
                self.assertFalse((self.root / "home").exists())

    def test_invalid_patch_fails_before_any_write(self):
        data = yaml.safe_load(self.config.read_text())
        data["harness-customization"]["agent"]["patches"].append({"id": "missing", "disabled": True})
        invalid = self.root / "invalid.yaml"
        invalid.write_text(yaml.safe_dump(data))
        with self.assertRaises(ValueError):
            loader.apply_harness(invalid, self.root)
        self.assertFalse((self.root / "home").exists())

    def test_invalid_metadata_fails_before_any_write(self):
        for value in (None, {}, {"name": "极乐世界", "description": " "}):
            with self.subTest(value=value):
                data = yaml.safe_load(self.config.read_text())
                data["harness-customization"]["agent"]["metadata"] = value
                invalid = self.root / "invalid.yaml"
                invalid.write_text(yaml.safe_dump(data))
                with self.assertRaises(ValueError):
                    loader.apply_harness(invalid, self.root)
                self.assertFalse((self.root / "home").exists())


if __name__ == "__main__":
    unittest.main()
