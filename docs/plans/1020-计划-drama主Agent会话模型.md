# drama 主Agent会话模型

- 类型：完整流程，新功能。
- 目标：实际Harness会话使用drama设置中的主Agent模型，不仅保存UI选择。
- 非目标：不改上游服务或公共文本客户端协议；不声称当前离线模型服务已可推理。
- AC-1：启动/主Agent配置变更→登记独立drama-provider和宿主默认模型。
- AC-2：当前会话读取快照、新项目创建→通过公开sessionController.selectModel选择配置，保留会话历史与工具注册。
- AC-3：制作文本选择改变→不改变主Agent模型；校验失败不写入配置。
- 依据：meiji syncChatModel已示范settings.mutate/update；宿主selectModel支持现有会话下次请求切换，无需重建会话。用户已明确要求实际切换，当前服务不可达不再作为配置切换的阻塞。
- 改动：drama/src/settings/main-agent.js、model-settings.js、index.js、http/project_routes.js、tools/creat_project_tool.js及测试。
- 验证：宿主配置与会话选择模拟、相关测试、真实服务会话投影模型；检查diff与更新索引。

## 验证结果
34项drama测试通过，0失败、0cancelled。真实宿主selectModel对现有会话返回200；Chrome模型按钮显示“选择模型，当前 GPT”。启动默认路由为drama-server/codex-gpt。修正宿主不接受off推理努力的问题，改为省略该参数。drama已重启。未发送真实模型推理请求，当前11435服务连通性此前失败。
