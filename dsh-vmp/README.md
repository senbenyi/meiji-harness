# dsh-vmp

DeepSeek Harness 的小型 VMP 操作插件。VMP 作为原生 `conversation.view` 页签，
不依赖 `dsh-better-sidebar`。插件界面与聊天工具共用
`llm-ai-model/app/vmp_remote.sh`，远端只执行唯一的 `scripts/mvp/run_mvp.sh`。

能力：spec 列表、静态检查、状态、图片、视频、一键成片、断点续跑、成片同步预览、
技术 QC 和人工验收。插件不复制工作流、不保存第二份生产状态。

```bash
cd /Users/mac/ai/llm-ai-veo/llm-dsh-plugins/dsh-vmp
npm test
dsh plugin --profile web add .
```

安装后重启本机 Harness。默认路径在 `cordis.patch.yml` 中，可按机器覆盖。
