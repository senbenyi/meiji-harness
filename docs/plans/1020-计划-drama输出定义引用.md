# drama输出定义引用

- 类型：完整流程，项目结构调整及输出说明生成。
- 目标：AI文本结果归入节点output，project_detail.json作为唯一字段定义，规则通过引用在组装时展开。
- 非目标：不修改meiji/公共RulesModel，不接入真实模型或节点编排，不迁移旧项目实例，不增加自动调用/持久化流程；视频接口请求结构、参数及程序节点保持原状。

## 验收标准与调研
| AC | 输入/状态 → 可观测结果 | 判定与证据 |
|---|---|---|
| AC-1 | 六类文本AI节点 → AI结果位于output，规则/状态/人工输入/媒体配置在外层 | 已确认；docs/project_detail.json及开发方向；人物/场景图片资产以ID在assets中关联 |
| AC-2 | 生成/修订规则 → 引用本节点output，审核引用统一review_output；生图使用统一媒体说明 | 已确认；8个skills中24份规则当前重复嵌入输出示例 |
| AC-3 | 修改同一份结构定义或字段说明 → 下一次展开引用自动反映变化，规则无需同步改字段 | 已确认；新建项目内输出引用解析器，默认每次读取定义，不缓存 |
| AC-4 | 引用不存在/循环/外部地址 → 明确报错，无未展开引用进入提示词 | 已确认；仅支持本地JSON Pointer及内部$ref，不发网络请求 |
| AC-5 | 项目保存与公共规则包 → 保持原有行为，JSON合法且不存在重复输出示例 | 基线drama5通过、0失败、0取消；ProjectModel/Manager只保存普通JSON，无字段专属实现 |

## 调用链与证据
ProjectManager.open/change → ProjectModel.read/replace/update；无AI执行器和规则装配入口。图谱query未准确覆盖新drama符号，结合context和文字检索确认，未用空结果断言无影响。输出解析器作为项目入口导出供后续执行器调用；不把字段处理放入公共包。

## 改动
1. docs/project_detail.json：六类文本AI结果包进output；人物reference_image/costume_images、场景image_generation移至各节点assets，按ID关联；程序节点保留原结构。output字段显式标记类型和说明，不按实际项目值猜类型；统一审核/媒体输出说明写在$defs。
2. skills/*.json：base业务规则保留，替换重复输出段为本地引用；三个动作仍只有base/supplement。
3. src/project/output_definition.js及src/index.js：读取最新定义、解析本地指针/$ref、展开base/supplement中的输出引用；返回字符串供提示词编排，不改变项目Model保存逻辑。
4. docs/开发方向.md：说明新路径、资产边界和接入方式。tests：数据结构/引用同步/三种视频模式/失败边界/原持久化行为。

## 验证
npm run test:drama，公共prompt-composer相关测试，JSON解析及24动作引用覆盖，git diff --check。图谱范围核对并更新索引。无真实模型调用，响应解析与业务校验由后续执行器接入。

## 待用户决定
无，按用户已确认结构执行。

## 验证结果
- AC-1～AC-5通过：6类文本AI节点output、8类规则/24动作引用、统一审核/媒体说明、动态读取与错误边界均通过验证。
- drama基线5通过；修改后12通过、0失败、0取消。公共prompt-composer25通过、0失败、0取消。
- 已用临时定义文件实际修改字段与解释，确认相同规则/Model无需更新，下一次renderNodeRules结果立即变化。
- 与HEAD逐项比较：clip_arrangement、videos、episodes及$defs中三种完整视频接口定义完全一致；未新增bindings。
- git diff --check通过。未运行真实模型和自动项目迁移；后续AI执行器需调用renderNodeRules并承担响应校验/落库。
- 图谱局限：src/index.js和测试文件impact为UNKNOWN，补查实际import仅drama测试；仅新增导出、更新测试示例，不修改ProjectManager/Model。detect_changes把测试局部回调saved识别为空ID，并将其关联到大量meiji/公共包流程，给出CRITICAL；context同样缺少该符号UID且存在不可能的生产代码→测试回调关系。源码补查与差异确认本任务仅drama，未把此异常当成图谱通过。最终索引刷新成功，重新detect_changes为LOW、0受影响流程，无partial/truncated；早期异常消失，新增文件用清单和测试补查。

## 用户补充边界
视频接口属于程序执行，不修改。已撤回本轮新增bindings及视频接口定义变化；视频提示词AI只引用原有模式定义的prompt子对象，不改完整请求结构与视频生成节点。
