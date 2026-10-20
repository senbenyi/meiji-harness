# drama 主Agent会话模型实施记录

## 已修改文件
- `projects/drama/src/settings/main-agent.js`：根据主Agent配置登记drama-server模型路由并更新Harness默认模型。
- `projects/drama/src/settings/model-settings.js`：主Agent保存前同步宿主配置，失败不写设置；制作文本配置不触发主Agent变更。
- `projects/drama/index.js`：注入宿主settings/credentials，公布服务后同步默认配置，提供applyMainAgent调用公开sessionController.selectModel。
- `projects/drama/src/http/project_routes.js`：真实会话读取快照及保存主Agent配置时应用当前选择。
- `projects/drama/src/tools/creat_project_tool.js`：新项目会话成功返回前应用主Agent模型。
- `projects/drama/tests/main-agent.test.js`：宿主路由、默认选择和同步失败测试。

## 验收标准核对
AC-1通过：宿主默认已保存drama-server/codex-gpt。
AC-2通过：实际现有会话selectModel返回200；浏览器原生模型按钮显示GPT，新项目会话复用相同选择入口。
AC-3通过：文本修改不同步主Agent；同步失败不覆盖原设置。

## 测试
34通过、0失败、0cancelled；原生浏览器确认“选择模型，当前 GPT”。第一次宿主验证拒绝reasoningEffort=off，移除多余推理参数后成功。diff --check通过。

## 限制
已验证模型选择，未验证真实生成与工具推理。服务沿用meiji的127.0.0.1:11435/v1，先前连接测试该服务未运行；切换模型不会使上游服务自动上线。
