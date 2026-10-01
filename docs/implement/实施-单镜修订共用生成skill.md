# 修订和改写编排实施

删除 revise-shot-table-skill.md：shot-revise 仍是内部功能 ID，基础文件映射到 generate-shot-table-skill.md，修改范围由 ShotRevisionModel 注入三类编排。

删除 rewrite-image-prompt-skill.md：保留内部接口与 Model，定向修改要求由代码编排；codeOnly 元数据没有基础文件，技能库和任务使用记录排除此项。基础生产规则仍由真实功能文件提供。

最终 constraints 12 份文档。相关技能、Model、接口、镜头文本及 HTTP 测试 47 通过，0 失败，0 取消；30 场景差集的 9 项删句均有去向，图片改写内容原样保留。未重启运行服务。
