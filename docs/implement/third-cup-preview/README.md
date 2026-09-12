# 《第三杯咖啡》制作资料

**首个产品正式审查入口：[产品001首版档案](../../products/产品001-第三杯咖啡首版审查档案.md)。**

普通使用者先看 [计划](../../plans/计划-第三杯咖啡六分钟预览短剧.md)、[分镜表](分镜表.md)，成片位于本地 `out/third-cup-preview/`。本次已完成120镜，先看 [执行清单](执行清单.md)、[最终报告](../实施-第三杯咖啡六分钟预览短剧.md)。进度见 `progress.json`；不要修改已有镜头请求再复用回执。

- `manifest.json`：120个镜头按数字排列的唯一制作清单，包含人物、动作、字幕及参考图选择。
- `subtitles.srt`：6分钟中文字幕；空字幕镜头延续前一句。
- `anchors.json`：人物与场景参考图服务器URL，以及对应来源任务。
- `shot-NNN.request.json`：该镜头要生成什么。
- `shot-NNN.receipt.json`：原任务身份与结果；恢复必须保留。
- `shot-NNN.attempts.json`：本地调用及恢复次数，跨脚本重启累计，最多3次。
- `shot-NNN.history.json`：服务器实际执行证据，用于检查采样不是缓存命中。
- 前四镜的 `reference.api/submission.json`：通过既有API提参考帧的节点图与提交找回记录。
- `acceptance-NNN.json`：前NNN镜的本地解码、规格、顺序和耗时验收，120对应完整成片。

所有制作入口在本地项目 `scripts/`。`third-cup-preview.mjs`调用既有插件单镜任务链与ComfyUI API；`third-cup-edit.py`在本地读取媒体URL、叠加中文字幕并拼接。脚本没有SSH入口，不在服务器执行临时制作脚本，也不修改服务器模型环境。

在本项目目录运行：

```sh
COMFYUI_URL=https://36we4j3zo503js-8188.proxy.runpod.net node scripts/third-cup-preview.mjs 10
/Users/mac/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/third-cup-edit.py --limit 10
```

将两个10都改为120继续全片。完成镜头复用原回执；失败只恢复对应镜头。超过重试预算或提交结果不明时，查原回执和队列，不能删除回执重新开始。Python需要Pillow；上述路径是本机已安装运行环境，未给服务器增加依赖。

## Harness 项目数据与本机交付

“项目”标签页中的“第三杯咖啡”（ID `0853b1fa`）已包含 4 锚点、6 幕、120 个已完成镜头和 2 份交付。导入快照为 `project-import.json`，原始制作资料及回执保持不变。刷新 Harness 页面后即可查看。

成片和字幕通过独立本机服务提供，无需复制文件。服务只允许两份登记文件，绑定 `127.0.0.1:3081`。在仓库根目录运行以下命令可启动（前台运行；保持终端打开）：

```sh
python3 scripts/third-cup-delivery-server.py
```

本轮已用当前用户的 `launchctl submit` 启动后台作业 `local.elysium.third-cup-delivery`，无需重复启动；停止命令为 `launchctl remove local.elysium.third-cup-delivery`。它未安装登录自启配置，注销或重启后需要重新启动。日志位于 `~/.dsh/logs/third-cup-delivery.log`。

- 成片：<http://127.0.0.1:3081/third-cup/film.mp4>
- 字幕：<http://127.0.0.1:3081/third-cup/subtitles.srt>

这些 URL 只供本机访问，不能作为跨设备分享链接。素材视频和角色参考图继续引用原服务器地址。
