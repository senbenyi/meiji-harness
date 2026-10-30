# 节点skills目录归位实施记录

## 已修改文件
- `projects/drama/src/node_box/<node>/skills/`：将16节点64个规则文件从节点根目录移入skills，保持四个英文文件名，不增加动作子目录；修正规则中的definition及共享契约相对链接。
- `src/node_runtime/node_rule_files.js`：统一加载路径增加skills一级。
- `tests/node-rule-files.test.js`：验证16目录64文件、根目录无残留、skills内无子目录、英文名及复制修改格式实际生效。
- `AGENTS.md`、`docs/开发方向.md`、`docs/项目数据契约.md`：同步当前结构和规则链接，历史记录不改写。

## 验收标准核对
AC-1至AC-3通过。目录盘点16个skills、64个英文文件、0子目录；旧节点及当前模型的统一加载、返回格式、记忆冻结和相对链接回归通过，未修改规则要求、项目数据或历史Task。

## 测试
相关基线42通过，改后相关42通过，全量424通过，均0失败、0取消（`/tmp/drama-skilldir-{baseline,target,full}.log`）。独立复制验收通过（`/tmp/drama-skilldir-copy.log`）。

重启前无活动Task；Harness重启成功，页面200；实际production-rules接口返回三动作及output_format。未调用真实模型，未修改项目及历史。

GitNexus nodeRuleFile影响CRITICAL已事先说明，实际只改路径和引用。diff检查通过。完整工作区变化189符号、228流程，无partial/truncated，整体critical包含既有改动；最终索引于收尾更新。

## 人工待办
无。
