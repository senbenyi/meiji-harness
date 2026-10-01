# skill 任务与会话目录调研

当前 constraints 存放 12 份实际任务基础正文，agent/panel.md 是唯一注册给 Harness 的会话 skill。load.js 从两处读取，index.js 通过 agentSkills 注册会话说明。

三个 JS 都有使用：catalog.js 登记内部功能和任务文件映射（含共用规则和纯编排元数据）；protocols.js 管理输出格式；load.js 导入两者，供服务端和测试读取、校验、生成哈希及注册会话 skill。无闲置文件，保留分工。

验收：task/ 放任务正文，session/ 放会话 skill；旧目录及有效代码/当前文档引用消失；加载和会话注册正常；正文、协议与提示词结果不变。
