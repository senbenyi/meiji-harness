# 单镜修订共用生成 skill

档位：完整流程。
1. catalog 的 shot-revise 改为复用 generate-shot-table-skill.md，删除 revise-shot-table-skill.md。
2. ShotRevisionModel 统一注入单镜范围、保留编号时长、未涉及事实不变及跨段问题不得冒充已修复；生产要求来自共享文件。
3. 更新命名集合测试、Model 回归及文档，生成前后提示词差集，仅跑相关测试，最后更新索引。

追加用户要求：rewrite-image-prompt-skill.md 也删除，两条定向改写要求由 ImagePromptModel 编排。image-prompt 保留内部接口元数据但不登记基础文件、不在技能库或任务技能记录中伪装为独立 skill；加载器允许明确 codeOnly 元数据无正文文件，实际生产功能仍要求文件存在。更新相关测试和差集。

完成：删除两份独立修订/改写文件，constraints 12 份；47 项相关测试通过，0 失败、0 取消；30 场景差集已核对。
