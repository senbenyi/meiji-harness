# session入口迁移实施记录

## 已修改文件
- projects/drama/session.js → projects/drama/src/session/index.js：移动源码，指导与工具注册内容不变。
- projects/drama/package.json：./session导出指向新目录。
- projects/drama/tests/create-project-tool.test.js、shared-tools.test.js：引用新位置。
- configure-harness.sh：npm安装前从项目清单验证session导出对应的文件，不固定根session.js。
- scripts/verify-copy.js、scripts/tests/workspace.test.js：按./session导出导入，支持项目自行组织目录。
- projects/drama/AGENTS.md：记录会话指导入口。

## 验收标准核对
| AC | 状态 | 证据 |
|---|---|---|
| AC-1 | 通过 | 包self-reference可加载新入口，根文件移除 |
| AC-2 | 通过 | verify:copy drama复制改目录/包名、离线安装、入口加载通过；实际重启成功 |
| AC-3 | 通过 | drama59/工程7通过，工具/指导注册销毁与创建行为保持 |

## 测试
基线drama59/工程7通过；改后59/7通过，0失败/取消。bash -n通过，verify:copy drama通过，公共./session包自引用加载通过。
实际Harness重启后页面加载正常、无浏览器错误、未修改用户设置。根npm test 859通过、0失败、0取消。
全范围detect_changes返回4变化符号、419影响项、21个已跟踪文件，包含前序未提交的设置与预览改动，无截断标志；移动的新文件与工程脚本由源码和实际加载补查。git diff --check通过，最终刷新索引。

## 人工待办
无。
