# skill 双页签整段编辑计划

1. node-skill.js、skill-detail.js：两个 tab，默认基础；补充单文本框保存，无逐条操作；切换仅隐藏区域以保留草稿。
2. node-skills.js：增加 replace 整段原子替换模式，空文本清空；保持旧数组数据结构及现有调用。skill-routes.js 调整读取上限以覆盖合法中文文本；app.js 删除逐条删除回调。
3. 更新节点 UI、通用 UI、保存及接口测试，核对默认 tab、切换草稿、失败重试、清空和作用域。
4. 开发文档同步，相关测试通过后更新代码图谱。

验证：只跑 node-skill-ui、skill-detail-ui、node-skills、skill-store、guidance-ui 相关测试，检查 diff。

完成：基线 12 通过；最终相关测试 18 通过，0 失败，0 取消。旧内容合并、空保存清空、失败保留及中文长度接口验证通过；diff 检查通过。
