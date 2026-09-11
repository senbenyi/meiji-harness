"""Start the persistent DeepSeek Harness service when ComfyUI boots."""

import subprocess


subprocess.Popen(
    [
        "bash",
        "-c",
        "until bash /workspace/harness/start.sh; do sleep 15; done",
    ],
    stdin=subprocess.DEVNULL,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
    start_new_session=True,
)

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
