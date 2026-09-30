# 合并图片下载与Base64步骤实施记录

## 已修改文件
- meiji/server/flow/operations/registry.js — 新任务改为三个步骤。
- meiji/server/generate/gateway.js — 下载与 Base64 编码由同一 image_download 步骤执行。
- meiji/client/task-steps.js — 合并步骤中文名称，保留已有历史记录的旧转换名称。
- meiji/tests/gateway.test.js、image.test.js、character-image-edit.test.js — 三步顺序、取消、失败与跳过覆盖。
- meiji/docs/tasks-and-steps.md、.agents/architecture.md — 更新三步说明。

## 验收标准核对
| AC | 状态 | 验证证据 |
|---|---|---|
| AC-1 | 通过 | 三种底层入口与人物修改完整任务三步，无计划外步骤 |
| AC-2 | 通过 | 下载异常、接收完字节后停止、旧 Base64 跳过合并步骤 |
| AC-3 | 通过 | 更新 UI 名称；完整任务登记候选及保存失败测试 |

## 测试
基线和改动后均为 382 通过、0 失败、0 取消；相关测试 41 通过、0 失败、0 取消。git diff --check 通过。

## 人工待办
无。
