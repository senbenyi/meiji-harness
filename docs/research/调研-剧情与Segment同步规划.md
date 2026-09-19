# 剧情与Segment同步规划

规格：AC-1 合并为一张卡片一次执行；AC-2 AI 同时规划剧情和片段，片段4～15秒且各场景时长不变；AC-3 原子保存并可直接进入分镜，非法结果不覆盖已存数据；AC-4 兼容旧项目与旧请求。
证据：production-workflow 分开两次生成；production.js 分阶段保存；segmentValues 已校验段长，plannedSegments 校验素材与衔接。
用户选择：AI 同时规划，非程序自动切分。
