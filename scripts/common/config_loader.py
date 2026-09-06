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
    }
    for key, pattern in patterns.items():
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
        for key in ("QWEN_API_LOCAL_PORT", "QWEN_MODEL_ID"):
            rendered = rendered.replace(f"__{key}__", str(runtime[key]))
        sys.stdout.write(rendered)


def harness_files(config, root):
    """先生成全部内容并验证，再由 apply 写入；保留 preset 的 !!js 标签。"""
    import contextlib
    import io

    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        write_harness_settings("render", config)
    settings = yaml.safe_load(output.getvalue())
    custom = yaml.safe_load(config.read_text())["harness-customization"]
    agent = custom["agent"]
    preset = settings["agent-presets"]["default"]
    base = agent["base"]
    for name in (preset, base):
        if not isinstance(name, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]*", name):
            raise ValueError("Agent preset 名称无效")
    if preset == base:
        raise ValueError("自定义 preset 不能与内置 preset 同名")
    source = root / "app/node_modules/@deepseek-ai/dsh/config/agent-presets" / base / "agent.cordis.yml"
    tree = yaml.compose(source.read_text())
    if not isinstance(tree, yaml.SequenceNode):
        raise ValueError("Agent preset 必须是列表")
    # patch 与 Cordis 一致：替换顶层字段，config 不做深合并。
    for patch in agent.get("patches", []):
        matches = [row for row in tree.value if isinstance(row, yaml.MappingNode)
                   and any(k.value == "id" and v.value == patch["id"] for k, v in row.value)]
        if len(matches) != 1:
            raise ValueError(f"Agent patch 未匹配唯一条目：{patch['id']}")
        row = matches[0]
        row.value = [(k, v) for k, v in row.value if k.value not in patch]
        row.value.extend(yaml.compose(yaml.safe_dump(patch)).value)
    profile = custom["profile"]
    if not isinstance(profile, list):
        raise ValueError("profile 必须是列表")
    prompt = yaml.safe_load((config.parent / custom["systemPromptFile"]).read_text())
    if not isinstance(prompt, dict) or not isinstance(prompt.get("persona"), str):
        raise ValueError("系统提示词必须包含 persona 文本")
    matches = [row for row in profile if row.get("id") == "system-prompt"]
    if len(matches) != 1:
        raise ValueError("profile 必须包含唯一 system-prompt 条目")
    matches[0]["config"] = prompt
    instructions = (config.parent / custom["instructionsFile"]).read_text()
    home = root / "home"
    return {
        home / "settings.yaml": output.getvalue(),
        home / "profiles/web/cordis.patch.yml": yaml.safe_dump(profile, allow_unicode=True, sort_keys=False),
        home / ".agent-presets" / preset / "agent.cordis.yml": yaml.serialize(tree, allow_unicode=True),
        home / "AGENTS.md": instructions,
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
    print("[CONFIG] Harness 设置、profile、Agent 和项目指令已覆盖")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("shell", "render", "check", "apply"))
    parser.add_argument("config", nargs="?", type=Path,
                        default=Path(__file__).resolve().parents[2] / "config/harness-settings.yaml")
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
