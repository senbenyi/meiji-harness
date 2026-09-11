"""Check that the shipped Elysium composition retains native agent capabilities."""
import json
from pathlib import Path
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "dsh-elysium-tools"
PRESET = PACKAGE / ".dsh/.agent-presets/elysium"


class PackagedPresetTests(unittest.TestCase):
    def test_composition_uses_native_plugins(self):
        tree = yaml.compose((PRESET / "agent.cordis.yml").read_text())
        entries = {dict((k.value, v) for k, v in row.value)["id"].value:
                   dict((k.value, v) for k, v in row.value) for row in tree.value}
        for name in ("persona", "skill-filesystem", "tool-fs", "planning", "delegation", "compaction"):
            self.assertIn(name, entries)
        for entry in entries.values():
            self.assertTrue(entry["name"].value.startswith(("@deepseek-ai/", "cordis:")))
        self.assertIn("isolate", entries["delegation"])
        self.assertFalse((PRESET / "standard.mjs").exists())

    def test_package_contains_persona_instructions_and_skills(self):
        self.assertIn(".dsh", json.loads((PACKAGE / "package.json").read_text())["files"])
        self.assertIn("'.dsh'", (PACKAGE / "build-scripts/package-registry.mjs").read_text())
        self.assertEqual(yaml.safe_load((PRESET / "preset.yml").read_text())["name"], "极乐世界")
        for relative in ("persona.md", "rules.md", "skills/creation-video/SKILL.md"):
            self.assertTrue((PRESET / relative).is_file(), relative)
        self.assertFalse((PRESET / "skills/creation-drama").exists())
        self.assertFalse((PRESET / "skills/character-reference").exists())
        self.assertFalse((ROOT / "app/config/harness-agent.md").exists())
        self.assertFalse((ROOT / "app/config/system-prompt.yaml").exists())


if __name__ == "__main__":
    unittest.main()
