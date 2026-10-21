# drama项目详情页实施记录

## 已修改文件
- `projects/drama/src/client/project-overview.js`、`project-ui.css`：实际复制meiji标题、编辑图标与概要分区结构，在drama独立维护；仅展示基本资料、原始剧本、剧本优化，支持完整结果与规则详情。
- `projects/drama/src/client/workbench.js`、`project-forms.js`：保存回调、原文编辑、独立页面状态、切会话销毁与晚到响应保护。
- `projects/drama/src/project/edit_project.js`、`src/tools/creat_project_tool.js`：字段白名单、旧值冲突检测、串行写入、会话项目绑定验证、工作区改名及创建重试名称保持。
- `projects/drama/src/http/project_routes.js`、`record_routes.js`：认证后的PATCH保存、更新SSE、公共规则UI静态模块白名单。
- `packages/prompt-composer/src/ui/rules-panel.js`：增加可选基础规则标题与说明文字，默认语义不变。
- `projects/drama/tests/project-edit.test.js`：编辑权限/冲突、真实HTTP持久化、失败恢复、脚本转义、剧本限定、规则回调、会话切换与晚到响应测试。
- 两侧README及对应计划同步。此前模型HTTP记录改动保留。

## 验收标准核对
| AC | 状态 | 验证方式与证据 |
|---|---|---|
| AC-1 | 通过 | DOM及Chrome仅两分区，标题/图标/基本资料/原文/剧本优化齐全；未展示剧集人物卡片 |
| AC-2 | 通过 | HTTP/Chrome写入JSON，工作区改名；错误保留表单，改名失败保留原数据 |
| AC-3 | 通过 | Chrome核对完整正文、摘要和预估时长，详情返回 |
| AC-4 | 通过 | 公共UI三动作规则；Chrome补充保存后核对磁盘JSON |
| AC-5 | 通过 | HTTP会话403/冲突409/串行补充；DOM切换关闭弹窗，晚到响应不覆盖新项目 |
| AC-6 | 通过 | 600/360/260px无横向溢出，恶意文本无HTML执行，空节点提示与真实宿主导航可用 |

## 测试
- 基线drama44通过，最终48通过；失败0、取消0。
- 根测试834项通过后补充1个会话切换测试，并重新运行全部drama测试通过；合计835项，无新增失败或取消。公共规则UI原有25项通过。
- 临时真实Harness/Chrome闭环通过，0模型调用、0浏览器异常，未修改真实项目用于测试。
- GitNexus完整detect_changes无partial/truncated，HIGH影响源于既有创建/HTTP/UI调用链；新文件用源码与实际运行补查。

## 人工待办
无。本次不增加节点生成执行器，也不改变项目模型结构。

最终已重启drama Harness；使用现有“三英战吕布”会话只读验证概要及公共规则页面，无浏览器异常。GitNexus索引更新成功，621个文件内容匹配；分析器的流程候选裁剪仍存在，不能把未列出的流程视为无影响。git diff --check通过。
