# Harness 技能目录隔离

`app/common/start_harness.sh` 将 `DSH_AGENTS_HOME` 固定为 `$DSH_HOME/agents`，使用户级 agents 技能来源改为 `$DSH_HOME/agents/skills`，不再加载 `~/.agents/skills`。该目录默认不存在，无需创建。

项目内 `.dsh/skills`、`.agents/skills`、`$DSH_HOME/skills` 以及 preset 的 `customSkillDirs` 继续按 Harness 原有规则加载；全局技能文件无需删除。

四套 Elysium preset 同时显式配置 `skill-filesystem.agentsHome` 为 preset 根目录上两级的 `agents/`，安装到本机后即 `$DSH_HOME/agents/`。这样直接运行 `dsh web` 也不会回退到 `~/.agents/skills`，不依赖启动脚本的环境变量。更新时需同步已有的本机 preset；部署脚本仅复制尚未安装的 preset。

配置修改后需重启本机 Harness。刷新页面或新建会话，确认 `/` 菜单不再显示来自 `~/.agents/skills` 的 RunPod 技能，创作 preset 仍可使用 `creation-video`。
