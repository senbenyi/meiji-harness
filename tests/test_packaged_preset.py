"""Check that the shipped Elysium compositions retain native agent capabilities."""
from pathlib import Path
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[1]
PRESETS_DIR = ROOT / "harness/.agent-presets"

ELYSIUM_PRESETS = {
    "elysium-teaching": "极乐世界 · 教学",
    "elysium-free": "极乐世界 · 自由",
    "elysium-director": "极乐世界 · 导演",
}

ALL_PRESETS = {"elysium-standard": "标准模式", **ELYSIUM_PRESETS}


class PackagedPresetTests(unittest.TestCase):
    def _assert_composition_uses_native_plugins(self, preset_dir):
        tree = yaml.compose((preset_dir / "agent.cordis.yml").read_text())
        entries = {dict((k.value, v) for k, v in row.value)["id"].value:
                   dict((k.value, v) for k, v in row.value) for row in tree.value}
        for name in ("persona", "skill-filesystem", "tool-fs", "planning", "delegation", "compaction"):
            self.assertIn(name, entries)
        for entry in entries.values():
            self.assertTrue(entry["name"].value.startswith(("@deepseek-ai/", "cordis:")))
        self.assertIn("isolate", entries["delegation"])
        self.assertFalse((preset_dir / "standard.mjs").exists())

    def test_all_presets_use_native_plugins(self):
        for preset_id in ALL_PRESETS:
            with self.subTest(preset=preset_id):
                self._assert_composition_uses_native_plugins(PRESETS_DIR / preset_id)

    def test_all_presets_have_correct_names(self):
        for preset_id, expected_name in ALL_PRESETS.items():
            with self.subTest(preset=preset_id):
                self.assertEqual(yaml.safe_load((PRESETS_DIR / preset_id / "preset.yml").read_text())["name"], expected_name)

    def test_elysium_presets_contain_persona_and_skills(self):
        for preset_id in ELYSIUM_PRESETS:
            preset_dir = PRESETS_DIR / preset_id
            with self.subTest(preset=preset_id):
                for relative in ("persona.md", "rules.md", "skills/creation-preview/SKILL.md", "skills/creation-regular/SKILL.md", "skills/creation-hd/SKILL.md"):
                    self.assertTrue((preset_dir / relative).is_file(), f"{preset_id}/{relative}")
                self.assertFalse((preset_dir / "skills/creation-video").exists())

    def test_no_legacy_files(self):
        self.assertFalse((ROOT / "app/config/harness-agent.md").exists())
        self.assertFalse((ROOT / "app/config/system-prompt.yaml").exists())


if __name__ == "__main__":
    unittest.main()
