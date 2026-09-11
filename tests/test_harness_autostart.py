from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class HarnessAutostartTest(unittest.TestCase):
    def test_retries_until_harness_starts(self):
        source = (ROOT / "deepseek-harness/config/comfyui-autostart.py").read_text()

        self.assertIn("until bash /workspace/harness/start.sh; do sleep 15; done", source)


if __name__ == "__main__":
    unittest.main()
