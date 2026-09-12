#!/usr/bin/env python3
"""解析本机 Harness 与远端模型隧道配置。"""

import argparse
from pathlib import Path
import re
import shlex
import sys
from urllib.parse import urlsplit

try:
    import yaml
except ImportError:
    sys.exit("[FAIL] 读取配置需要 Python 3 和 PyYAML")


def write_harness_settings(mode, config):
    settings = yaml.safe_load(config.read_text())
    runtime = settings.pop("harness-runtime")
    settings.pop("harness-customization", None)
    patterns = {
        "QWEN_SSH_TARGET": r"[A-Za-z0-9_][A-Za-z0-9._-]*(?:@[A-Za-z0-9._-]+)?",
        "QWEN_MODEL_ID": r"[A-Za-z0-9._-]+",
        "QWEN_API_LOCAL_PORT": r"[0-9]+",
        "QWEN_API_REMOTE_PORT": r"[0-9]+",
        "LOCAL_HARNESS_PORT": r"[0-9]+",
    }
    for key in ("QWEN_LOCAL_HOST", "QWEN_REMOTE_HOST", "LOCAL_HARNESS_HOST"):
        patterns[key] = r"[A-Za-z0-9][A-Za-z0-9._-]*"
    for key in ("LOCAL_DSH_HOME",):
        patterns[key] = r"/[A-Za-z0-9._/-]+"
    for key in ("COMFYUI_URL",):
        value = runtime[key]
        if not isinstance(value, str) or not value or value != value.strip():
            raise ValueError(f"{key} 缺失或为空")
        url = urlsplit(value)
        if url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password or url.query or url.fragment or any(c.isspace() for c in value):
            raise ValueError(f"{key} 必须为不含凭据、查询参数的 HTTP(S) 地址")
        if url.port is not None and not 1 <= url.port <= 65535:
            raise ValueError(f"{key} 端口无效")
        patterns[key] = r"[A-Za-z0-9:/._~-]+"
    for key, pattern in patterns.items():
        if type(runtime[key]) not in (str, int):
            raise ValueError(f"{key} 缺失或类型无效")
        value = str(runtime[key])
        if not re.fullmatch(pattern, value):
            raise ValueError(f"{key} 格式无效")
        if key.endswith("_PORT") and not 1 <= int(value) <= 65535:
            raise ValueError(f"{key} 必须在 1–65535 之间")
    if mode == "shell":
        for key in patterns:
            print(f"{key}={shlex.quote(str(runtime[key]))}")
        print(f"DSH_PERMISSION_MODE={shlex.quote(settings['permission']['defaultPreset'])}")
    else:
        rendered = yaml.safe_dump(settings, allow_unicode=True, sort_keys=False)
        for key in ("QWEN_API_LOCAL_PORT", "QWEN_MODEL_ID", "QWEN_LOCAL_HOST", "COMFYUI_URL"):
            rendered = rendered.replace(f"__{key}__", str(runtime[key]))
        sys.stdout.write(rendered)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("shell", "render"))
    parser.add_argument("config", nargs="?", type=Path,
                        default=Path(__file__).resolve().parents[2] / "harness/config/settings.yaml")
    args = parser.parse_args()
    write_harness_settings(args.mode, args.config)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError, AttributeError, yaml.YAMLError) as exc:
        sys.exit(f"[FAIL] 配置读取失败：{exc}")
