# 简化公共 Toast

- 类型：重构，完整流程（涉及公共包、两个调用方和依赖配置）。
- 目标：公共 UI 只提供传入文字即可显示的 showToast(message)。
- 非目标：不改公共 task 通知机制、业务任务或项目数据，不增加其他 UI。

## 验收标准与调研结论
| AC | 输入/状态 → 可观测结果 | 状态 | 依据 |
|---|---|---|---|
| AC-1 | showToast('文字') → 页面直接显示原文字、2.5秒后移除 | 已确认需简化 | packages/ui/index.js 当前有document/kind/duration、关闭句柄、WeakMap和Shadow DOM |
| AC-2 | 连续调用 → 仅保留最新提示；文本不解释HTML | 待验证 | 保留最小DOM替换和textContent |
| AC-3 | 任务历史复制反馈 → 两个调用方仅传message，原有历史功能可用 | 已确认 | drama client/workbench、project-overview onNotify |
| AC-4 | 公共ui包 → 不再有tests目录、test脚本或专属jsdom依赖 | 已确认 | 用户要求，当前只有toast |

## 调用链与影响
- task UI onNotify → drama两个调用方 → @agent-modules/ui showToast。
- GitNexus showToast upstream：LOW，2个直接调用方、1条受影响流程；无关闭句柄业务调用方。
- 既有Drama基线167通过/0失败/0 cancelled；公共UI旧测试改前2项，记录执行结果后删除。

## 待用户决定
无。

## 改动
1. packages/ui/index.js：单参数、普通DOM、固定样式与自动移除；删除配置及复杂生命周期。
2. packages/ui/package.json、tests/toast.test.js、根package-lock：去掉测试脚本、测试文件和专属测试依赖；保留公共导出。
3. drama workbench/project-overview：onNotify仅传文字；同步开发方向。

## 验证
临时JSDOM烟测单参数、纯文本、连续替换和自动消失，不新增仓库测试；Drama回归、verify:install和diff检查；detect_changes后更新图谱。

## 验证结果
- AC-1/AC-2：临时JSDOM烟测通过，单参数文字、纯文本、连续替换和实际2.5秒自动移除均验证。
- AC-3：Drama167通过、0失败、0 cancelled，与基线一致；两个调用方已只传message。
- AC-4：已删除tests目录、test脚本和ui专属jsdom依赖；根锁文件仅移除packages/ui对应依赖项。删除前旧测试2通过。
- verify:install通过；五个npm tarball隔离离线安装并运行，ui公共导出有效。
- git diff --check通过；本轮影响LOW，detect_changes累计未提交差异为critical，无partial/truncated，前序改动保留。
- 最终force图谱更新成功（11267节点、31642边）；纯浏览器资源变更，无需重启。
