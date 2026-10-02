# 统一审核 JSON 协议调研
## 规格
- 目标：所有 AI 审核共用 passed/issues JSON 协议，移除 PASS/FAIL 文本解析。
- AC-1：所有审核和复审包含同一协议并启用 JSON 模式，生成格式不受影响。
- AC-2：严格校验 passed 布尔值、issues 数组及非空 location/reason/requirement；通过只能空问题，未通过必须有问题；格式错不放行、不自动修订。
- AC-3：有效未通过最多修订一次，程序校验问题合并；页面与历史显示完整问题，草稿保留。
## 证据与影响
rg 检索全部生产代码：四个领域 Model、人工编辑整包接口及 reviewParts 含重复文本协议；其余 Model 共用 reviewParts。全部审核经 text-steps.reviewStep。图谱上游涉及生成/修订、任务步骤、节点状态及展示；结合实际调用确认不为图片/视频新增审核请求。
存储现有 check.passed/failures、步骤 verdict/reasons 可表达新结果，保留领域存储结构；接口新 JSON 在请求边界解析成展示字符串，不迁移历史数据，不加入旧协议回退。
## 待决定
无。
