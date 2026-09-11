"""Start the persistent DeepSeek Harness service when ComfyUI boots."""

import subprocess


subprocess.Popen(
    ["bash", "/workspace/harness/start.sh"],
    stdin=subprocess.DEVNULL,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
    start_new_session=True,
)

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
