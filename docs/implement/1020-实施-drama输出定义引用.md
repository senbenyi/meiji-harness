# drama输出定义引用实施记录

## 已修改文件
- `projects/drama/docs/project_detail.json`：6类文本AI节点结果归入output；人物/场景图片资产移到外层assets按ID关联；统一审核与媒体说明写入$defs。视频AI提示词只引用既有模式的prompt子对象。
- `projects/drama/skills/*.json`：8节点24动作保留业务规则，重复输出示例替换为文档内引用；仍为base/supplement。
- `projects/drama/src/project/output_definition.js`：展开本地JSON Pointer及$ref，renderNodeRules每次读取当前定义，返回当前有效规则；不缓存、不修改项目数据。
- `projects/drama/src/index.js`：导出解析与组装函数。
- `projects/drama/tests/output-definition.test.js`及原项目测试：验证定义变化联动、数据所有权、24动作、三种视频提示词、引用失败与持久化。
- `projects/drama/docs/开发方向.md`：新路径和使用边界。

## 验收标准核对
| AC | 状态 | 证据 |
|---|---|---|
| AC-1 | 通过 | 文本AI结果与规则/状态/意见/图片资产分离 |
| AC-2 | 通过 | 24动作只有base/supplement，全部引用可展开；视频接口完整结构不改 |
| AC-3 | 通过 | 临时文件中新增字段、修改解释后，同一Model下次组装立即更新，原规则不变 |
| AC-4 | 通过 | 缺失、非法转义、外部、循环、未完整引用明确失败 |
| AC-5 | 通过 | 项目保存测试通过，公共RulesModel无改动，节点与定义JSON合法 |

## 测试
- `npm run test:drama`：基线5通过，最终12通过、0失败、0取消。
- `npm test --workspace @agent-modules/prompt-composer`：25通过、0失败、0取消。
- 源数据比较：clip_arrangement/videos/episodes和multimodal/text_to_video/first_last_frame完整接口定义与HEAD相同；无bindings字段。
- `git diff --check`通过。

图谱：新增文件以清单/测试补充；已有导出和测试入口impact为UNKNOWN，以真实import检索确认。detect_changes将局部测试回调saved映射为空ID并关联到大量无关流程，报告CRITICAL；context缺少UID且出现生产代码访问局部测试回调的错误关系，最初不能据此宣称图谱通过。最终刷新索引成功（8043节点、23801边），重新detect_changes为LOW、0受影响流程，无partial/truncated；早期异常已随刷新消失。新增JSON及代码仍通过实际文件清单与测试补足图谱覆盖。未为修复工具问题改动无关代码。

## 人工待办
后续AI执行器调用renderNodeRules后再交公共编排包，负责响应解析、类型/业务校验与写入output；资产记录按稳定ID维护。项目创建、已有项目迁移、真实模型调用不在本次范围。
