# 简化公共 Toast 实施记录

## 已修改文件
- packages/ui/index.js：收紧为showToast(message)，直接创建提示DOM，纯文本，固定2.5秒移除，连续调用替换旧提示。
- packages/ui/tests/toast.test.js：按用户要求删除，移除空tests目录。
- packages/ui/package.json、package-lock.json：删除test脚本和ui专属jsdom开发依赖，保留公共导出。
- projects/drama/src/client/workbench.js、project-overview.js：onNotify只传入message。
- projects/drama/docs/开发方向.md：更新单参数契约。

## 验收标准核对
| AC | 状态 | 证据 |
|---|---|---|
| AC-1 | 通过 | 临时JSDOM验证实际显示及2.5秒自动消失 |
| AC-2 | 通过 | 连续替换且HTML字符串原样显示 |
| AC-3 | 通过 | 167项Drama回归，无新增失败 |
| AC-4 | 通过 | 文件和依赖差异核对、verify:install |

## 测试
旧公共UI测试改前2通过、0失败、0 cancelled；按用户要求删除，不新增仓库测试。Drama基线/改后均167通过、0失败、0 cancelled。临时烟测通过，verify:install隔离打包安装通过，git diff --check通过。GitNexus修改前showToast及调用文件LOW；累计detect_changes无partial/truncated。最终force索引成功（11267节点、31642边）。纯浏览器资源修改，无重启、无真实模型调用。

## 人工待办
无。
