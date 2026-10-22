# 公共Toast与任务资料归属

- 类型：完整流程，新公共UI包及任务详情布局。
- 目标：复制反馈改为短暂公共toast；输入依赖与任务输出均归对应任务卡片。
- 非目标：不修改任务模型、数据库、执行器或已有项目记录；不扩展用户空白第3项。

## 验收标准与调研结论
| AC | 输入/状态 → 可观察结果 | 状态与依据 |
|---|---|---|
| AC-1 | 点击任务复制 → 公共toast短暂显示成功/失败，不再在顶部固定留下提示 | 已确认：createTaskHistory.copy目前写notice；两个drama入口可注入onNotify |
| AC-2 | 任务详情 → 每个任务标题/身份后是本盒子输入、步骤、输出；组头没有输入依赖 | 已确认：目前inputDependencies(data)在组头聚合，需逐任务移动 |
| AC-3 | 多任务 → 各输入/输出只用自己的历史步骤；折叠箭头和完整复制保留 | 已确认：已有task_id筛选与jsonRecord可复用 |
| AC-4 | 公共包 → 独立安装、无drama/meiji依赖；toast安全文本、自动关闭、连续点击替换不累积 | 待实施新packages/ui |

## 调用链与影响
workbench.mount/project-overview.createProjectView → createTaskHistory → copy/onNotify → 公共showToast；drama的harness-http认证静态白名单提供ui/index.js并转换包引用。
图谱status有效；createTaskHistory、两个客户端入口、serveRecordRoute、createProjectHttpHandler影响均UNKNOWN，已逐个源码核对实际调用、静态资源白名单与已有harness-http/UI测试，不当作无影响。

## 待决定
无。

## 改动与验证
1. packages/ui：新增showToast、公开exports及测试，覆盖自动消失、连续替换、文档隔离、安全文本。AC-1/4。
2. task/ui/index.js：新增onNotify复制回调，不再写固定notice；inputDependencies改接收单个Task与其steps，移入任务区，输出保留。更新多任务与复制测试。AC-1/2/3。
3. drama两个历史入口传入showToast；package.json与根lock、静态白名单/包引用转换同步，扩展harness-http静态资源测试。AC-1/4。
4. verify-install加入新包且保留task独立安装验证；更新既有公共包/任务详情文档。
5. 相关测试、根npm test、verify:install、verify:copy、git diff --check、detect_changes、索引；实际浏览器检查布局和toast自动消失。

## 验证结果
基线916通过，本次全量919通过，0失败/0取消；ui2项、task39项、drama111项通过。独立安装与指定drama的复制验收通过。浏览器核对任务内输入/输出顺序、组头无输入、toast自动消失及无固定notice。git diff --check通过；detect_changes包括既有差异critical，无partial/truncated，新包已单独测试。详情见对应实施记录。
