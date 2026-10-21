# Harness模型请求记录

- 类型：完整流程，公共能力、宿主插件接入与生命周期。
- 目标：Harness实际交给模型适配器的完整提示词、工具声明、生成参数和返回流写入HTTP记录，主会话、标题、子会话与重试均经统一接口记录。
- 非目标：改宿主源码、伪造HTTP原始报文/成功状态码、实现尚未存在的业务执行器。

## 验收标准与证据
| AC | 输入/状态 → 结果 | 状态 | 证据 |
|---|---|---|---|
| AC-1 | llm/stream调用 → 发出前持久化完整请求，原参数不变 | 已通过 | 宿主llm公开waterfall，GenerateOptions包含messages/system/tools/sessionId/purpose |
| AC-2 | 正常/工具调用/错误/取消/消费者退出 → 返回增量和合并内容保存，行为透传 | 已通过 | StreamChunk含block/delta/usage/finish |
| AC-3 | 并发/重试/关闭 → 独立ID、记录不混合，关闭保留部分返回，晚到不写关闭数据库 | 已通过 | HttpRecords一次transfer一行，service统一管理生命周期 |
| AC-4 | HTTP记录页面 → 标注模型调用与用途，成功不能因无HTTP状态码显示失败 | 已通过 | 现UI对status=null直接显示失败，需调整 |
| AC-5 | 之前创建项目的三次调用 → 可查完整历史上下文，显式标记日志还原且重复执行不重复入库 | 已通过 | 已导出两轮主调用与一次标题请求，非HTTP抓包 |

## 调用链与图谱
Harness llm.stream→llm/stream waterfall→drama根插件监听→公共createModelRecorder→HttpRecords.record→drama records.sqlite→HTTP记录API/UI。
公开回调在适配器外层，不保证观测SDK内部自动重试和HTTP头/状态。每次waterfall调用单独记录；应用重试再次进入时分别保存，不虚构网络尝试。对外标为MODEL/model://。
图谱status有效；HttpRecords影响CRITICAL/direct3，已告知；本次不修改其schema和类实现。apply UNKNOWN已源码补查index注册与drama集成。新增公共模块不导入宿主或业务。

## 待用户决定
无。当前已说明记录层级，持续记录适配器完整上下文，不冒充HTTP原始报文。

## 改动
1. http-client/src/model-records.js及公开exports：通用流记录器，保存完整请求、chunks及合并结果；取消/异常/关闭保护。
2. drama records/service与index：持有记录器、注册全局llm/stream，关闭先结束记录再关闭DB。
3. HTTP公共UI：模型调用标签、成功/失败/等待状态；保留请求与返回详情。
4. 单测、插件入口集成、隔离Harness模拟模型验证、独立安装、开发文档。
5. 正式环境回填既有三次日志，显式标记历史还原、使用确定ID防重复，重启后验证记录可读。

## 验证结果
基线HTTP35、drama43通过，0失败、0取消。改后根npm test共831通过、0失败、0取消，HTTP42与drama44项通过。隔离Harness使用模拟模型经真实会话创建项目，观测到两轮主请求与一次标题请求且与入库条数一致，完整messages/tools、工具结果及返回流可查。独立安装与复制验证通过。正式Harness已重启，3条历史还原回填并经真实页面读取验证。git diff --check通过；完整detect_changes无partial/truncated，新文件另以源码和测试核对。
