#!/usr/bin/env bash
# 返回项目目录名；唯一项目自动选择，多项目须通过参数或 AGENT_PROJECT 指定。
select_project() {
  local repo="$1" selected="${2:-}" file
  local candidates=()
  if [[ -z "$selected" ]]; then
    for file in "$repo"/projects/*/package.json; do
      [[ -f "$file" ]] || continue
      candidates+=("$(basename "$(dirname "$file")")")
    done
    if [[ ${#candidates[@]} -ne 1 ]]; then
      echo "请指定项目：脚本参数 <项目目录名> 或 AGENT_PROJECT；当前项目数 ${#candidates[@]}。" >&2
      return 1
    fi
    selected="${candidates[0]}"
  fi
  if [[ ! "$selected" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]]; then
    echo "项目目录名无效：$selected" >&2
    return 1
  fi
  if [[ ! -f "$repo/projects/$selected/package.json" ]]; then
    echo "找不到项目：projects/$selected/package.json" >&2
    return 1
  fi
  printf '%s\n' "$selected"
}
