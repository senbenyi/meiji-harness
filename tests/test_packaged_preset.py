"""Check that the shipped Elysium composition retains native agent capabilities."""
import json
from pathlib import Path
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "dsh-elysium-tools"
PRESET = PACKAGE / "presets/elysium"


class PackagedPresetTests(unittest.TestCase):
    def test_composition_only_patches_elysium_differences(self):
        tree = yaml.compose((PRESET / "agent.cordis.yml").read_text())
        self.assertEqual(len(tree.value), 1)
        entry = {k.value: v for k, v in tree.value[0].value}
        self.assertEqual(entry["name"].value, "./standard.mjs")
        config = {k.value: v for k, v in entry["config"].value}
        patches = config["patches"].value
        self.assertEqual([next(v.value for k, v in row.value if k.value == "id")
                          for row in patches], ["persona", "skill-filesystem"])
        self.assertTrue((PRESET / "standard.mjs").is_file())

    def test_package_contains_persona_instructions_and_skill_references(self):
        self.assertIn("presets", json.loads((PACKAGE / "package.json").read_text())["files"])
        self.assertIn("'presets'", (PACKAGE / "build-scripts/package-registry.mjs").read_text())
        self.assertEqual(yaml.safe_load((PRESET / "preset.yml").read_text())["name"], "极乐世界")
        for relative in ("persona.md", "instructions.md", "skills/creation-video/SKILL.md",
                         "skills/creation-drama/SKILL.md", "skills/creation-drama/references/production.md",
                         "skills/creation-drama/references/director-cases.md"):
            self.assertTrue((PRESET / relative).is_file(), relative)
        self.assertFalse((ROOT / "app/config/harness-agent.md").exists())
        self.assertFalse((ROOT / "app/config/system-prompt.yaml").exists())


if __name__ == "__main__":
    unittest.main()
