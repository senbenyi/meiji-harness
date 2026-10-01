# skill 任务与会话目录

1. skills/constraints → skills/task；skills/agent → skills/session，正文不变。
2. load.js 改目录路径与错误文案，agentSkills 改为 sessionSkills，index.js 和测试同步；其他正文属性 constraints 不改，避免扩大数据结构变更。
3. 更新代码、日志、测试和当前文档的文件引用。保留 catalog.js/load.js/protocols.js，README 说明职责。
4. 相关加载、接口和注册回归，前后提示词快照核对，diff 检查后更新图谱。

基线：18 项通过，0 失败、0 取消。

完成：目录、加载、注册和文档引用更新；三个 JS 均保留。18 项相关测试通过，0 失败、0 取消；13 份正文和 30 场景提示词完全一致。
