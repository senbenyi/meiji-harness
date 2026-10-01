# skill 任务与会话目录实施

skills/task 保存 12 份任务正文；skills/session/panel.md 保存会话 skill。加载路径、会话注册函数 sessionSkills、日志、源码/测试及当前文档引用已同步。

catalog.js、load.js、protocols.js 均有真实调用，职责分别为功能映射、读取校验与会话注册数据、输出协议，全部保留。

基线与最终相关加载、存储 HTTP、提示词接口和图片 Model 测试 18 通过，0 失败，0 取消。13 份 Markdown 原文 Buffer 比较一致，30 场景前后快照逐字一致，diff 检查通过。未重启运行服务，已有进程需重新加载插件以使用新目录。
