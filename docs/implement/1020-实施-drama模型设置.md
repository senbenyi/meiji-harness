# drama 模型设置实施记录

## 已修改文件
- `projects/drama/src/settings/model-settings.js`：模型目录、主Agent/文本GPT默认，公共setting存储与校验，公共http-client文本/图片/视频调用。
- `projects/drama/src/http/project_routes.js`：鉴权设置读取与保存，大小限制及面板请求标识；不要求先有项目会话。
- `projects/drama/src/client/workbench.js`：替换固定语言值，加载设置、展示四模型、保存及刷新恢复。
- `projects/drama/src/client/settings-ui.js`：可选模型标题参数，drama主Agent命名，保留meiji原标题。
- `projects/drama/index.js`：组装设置服务供HTTP和制作调用。
- `projects/drama/package.json`、根锁文件：声明公共http-client和setting依赖。
- `projects/drama/tests/model-settings.test.js`、`create-project-http.test.js`：更新异步设置入口，验证持久化、非法输入、HTTP、公共调用及UI回退。

## 验收标准核对
AC-1/2/4通过。AC-3仅保存主Agent GPT配置，实际Harness工具会话切换尚未完成；未把文本生成接口当成工具会话适配器。

## 测试
基线28通过；drama32通过；完整805通过，0失败、0cancelled。Chrome验证五项选择、文本修改及刷新恢复、恢复GPT默认，无脚本错误。diff --check通过。

## 未完成
当前公共complete仅非流式最终文本；旧codex-gpt服务不支持工具。主Agent实际GPT工具会话未接通。当前11435不可达，真实模型调用未验证；制作接口通过模拟HTTP验证。未修改现有宿主会话模型。
