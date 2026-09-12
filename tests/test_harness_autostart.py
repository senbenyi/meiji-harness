from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class HarnessAutostartTest(unittest.TestCase):
    def test_retries_until_harness_starts(self):
        source = (ROOT / "harness/config/comfyui-autostart.py").read_text()

        self.assertIn("until bash /workspace/harness/start.sh; do sleep 15; done", source)

    def test_harness_is_confined_to_an_unprivileged_workspace(self):
        deploy = (ROOT / "harness/deploy.sh").read_text()
        start = (ROOT / "harness/start.sh").read_text()
        tunnel = (ROOT / "harness/qwen-tunnel.sh").read_text()
        settings = (ROOT / "harness/config/settings.yaml").read_text()
        security = (ROOT / "harness/config/operator-security.patch.yml").read_text()
        operator_agent = (ROOT / "harness/config/operator-agent.cordis.yml").read_text()

        self.assertIn("useradd --system --no-create-home", deploy)
        self.assertIn('chown root:"$SERVICE_GROUP" "$HARNESS_ROOT/runtime" "$APP_ROOT" "$PACKAGE_ROOT"', deploy)
        self.assertIn('chown root:"$SERVICE_GROUP" "$NODE_ROOT"', deploy)
        self.assertIn('"$HOME_ROOT/operator-security.patch.yml"', deploy)
        self.assertIn('"$HOME_ROOT/.agent-presets/elysium-teaching/agent.cordis.yml"', deploy)
        self.assertIn('OPERATOR_ROOT="$HARNESS_ROOT/operator-workspace"', start)
        self.assertIn('cd "$OPERATOR_ROOT"', start)
        self.assertIn('env HOME="$OPERATOR_ROOT" DSH_HOME="$DSH_HOME"', start)
        self.assertIn('setpriv --reuid="$SERVICE_UID" --regid="$SERVICE_GID" --init-groups', start)
        self.assertIn('ps -p "$pid" -o args=', start)
        self.assertNotIn('/proc/$pid/cmdline', start)
        self.assertIn('ps -p "$pid" -o args=', tunnel)
        self.assertNotIn('/proc/$pid/cmdline', tunnel)
        self.assertIn("DSH_PERMISSION_MODE=workspace-write", start)
        self.assertIn('--patch "$SECURITY_PATCH"', start)
        self.assertIn("defaultPreset: workspace-write", settings)
        self.assertNotIn("defaultPreset: danger-full-access", settings)
        self.assertNotIn("cd /workspace\n", start)
        self.assertIn("id: ui-permission", security)
        self.assertIn("id: tool-bash", security)
        self.assertNotIn("disabled: false", security)
        self.assertIn("id: tool-skill", operator_agent)
        for tool in ("tool-bash", "tool-pwsh", "tool-fs", "tool-fs-search", "tool-jobs",
                     "tool-subagent", "tool-web"):
            self.assertNotIn(f"id: {tool}", operator_agent)


if __name__ == "__main__":
    unittest.main()
