#!/usr/bin/env python3
"""解析并应用 Harness 配置。"""

import argparse
import os
from pathlib import Path
import re
import shlex
import sys
import shutil
import tempfile
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
        "HARNESS_ROOT": r"/[A-Za-z0-9._/-]+",
        "PLUGINS_ROOT": r"/[A-Za-z0-9._/-]+",
        "PROJECT_ROOT": r"/[A-Za-z0-9._/-]+",
        "COMFYUI_INPUT_ROOT": r"/[A-Za-z0-9._/-]+",
        "QWEN_SSH_TARGET": r"[A-Za-z0-9_][A-Za-z0-9._-]*(?:@[A-Za-z0-9._-]+)?",
        "QWEN_MODEL_ID": r"[A-Za-z0-9._-]+",
        "QWEN_API_LOCAL_PORT": r"[0-9]+",
        "QWEN_API_REMOTE_PORT": r"[0-9]+",
        "HARNESS_WEB_PORT": r"[0-9]+",
        "HARNESS_LOCAL_PORT": r"[0-9]+",
    }
    for key in ("HARNESS_SSH_TARGET", "HARNESS_HOST", "HARNESS_LOCAL_HOST", "QWEN_LOCAL_HOST", "QWEN_REMOTE_HOST", "LOCAL_HARNESS_HOST"):
        patterns[key] = r"[A-Za-z0-9][A-Za-z0-9._-]*"
    for key in ("HARNESS_PYTHON", "MINIMAX_H3_COMFYUI_OUTPUT_ROOT", "ARTIFACTS_ROOT", "ELYSIUM_TOOLS_STATE_ROOT", "LOCAL_DSH_HOME"):
        patterns[key] = r"/[A-Za-z0-9._/-]+"
    patterns["LOCAL_HARNESS_PORT"] = r"[0-9]+"
    for key in ("MINIMAX_H3_COMFYUI_URL", "MINIMAX_H3_COMFYUI_PUBLIC_URL"):
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
        for key in ("QWEN_API_LOCAL_PORT", "QWEN_MODEL_ID", "QWEN_LOCAL_HOST", "PLUGINS_ROOT"):
            rendered = rendered.replace(f"__{key}__", str(runtime[key]))
        sys.stdout.write(rendered)


def harness_files(config, root):
    """生成部署设置与 profile；Elysium preset 和技能由插件包提供。"""
    import contextlib
    import io

    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        write_harness_settings("render", config)
    document = yaml.safe_load(config.read_text())
    customization = yaml.safe_dump(document["harness-customization"])
    for key, value in document["harness-runtime"].items():
        customization = customization.replace(f"__{key}__", str(value))
    custom = yaml.safe_load(customization)
    profile = custom["profile"]
    if not isinstance(profile, list):
        raise ValueError("profile 必须是列表")
    home = root / "home"
    return {
        home / "settings.yaml": output.getvalue(),
        home / "profiles/web/cordis.patch.yml": yaml.safe_dump(profile, allow_unicode=True, sort_keys=False),
    }


def apply_harness(config, root, check=False):
    files = harness_files(config, root)
    if check:
        print("[CHECK] Harness 配置可生成")
        return
    for target, content in files.items():
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            shutil.copy2(target, target.with_suffix(target.suffix + ".previous"))
        fd, temporary = tempfile.mkstemp(prefix=".harness-", dir=target.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                stream.write(content)
            os.replace(temporary, target)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    print("[CONFIG] Harness 部署设置与 profile 已覆盖")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("shell", "render", "check", "apply"))
    parser.add_argument("config", nargs="?", type=Path,
                        default=Path(__file__).resolve().parents[2] / "app/config/harness-settings.yaml")
    parser.add_argument("--harness-root", type=Path)
    args = parser.parse_args()
    if args.mode in {"check", "apply"}:
        if args.harness_root is None:
            parser.error("check/apply 需要 --harness-root")
        apply_harness(args.config, args.harness_root, check=args.mode == "check")
    else:
        write_harness_settings(args.mode, args.config)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError, AttributeError, yaml.YAMLError) as exc:
        sys.exit(f"[FAIL] 配置读取失败：{exc}")
