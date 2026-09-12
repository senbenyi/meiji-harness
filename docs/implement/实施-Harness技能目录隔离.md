# Harness 技能目录隔离

`app/common/start_harness.sh` 将 `DSH_AGENTS_HOME` 固定为 `$DSH_HOME/agents`，使用户级 agents 技能来源改为 `$DSH_HOME/agents/skills`，不再加载 `~/.agents/skills`。该目录默认不存在，无需创建。

项目内 `.dsh/skills`、`.agents/skills`、`$DSH_HOME/skills` 以及 preset 的 `customSkillDirs` 继续按 Harness 原有规则加载；全局技能文件无需删除。

启动脚本修改后需重启本机 Harness。刷新页面或新建会话，确认 `/` 菜单不再显示来自 `~/.agents/skills` 的 RunPod 技能，创作 preset 仍可使用 `creation-video`。
