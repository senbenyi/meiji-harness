# 剧情与Segment同步规划

修改前端production-workflow、production-ui、project-generation；后端production与production-rules；新增story-segments规则；更新场景规则、工具说明与创作流程提示、README。
新增story-segments.test.js验证原子性、场景绑定、上下限、总时长、直接进入分镜与重新执行；更新UI和资源打包测试。
专项29项通过；全量247项插件测试、10项Harness测试通过。构建、Registry打包和重启完成，3080返回预期鉴权响应；发布产物包含联合规划标识、卡片与规则。未触发真实模型生成。

同步4份会话预设及本机对应规则，避免继续要求单独执行Segment阶段。git diff --check通过。
