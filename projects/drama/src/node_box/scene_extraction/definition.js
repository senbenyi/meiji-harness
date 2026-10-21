import { string, object, array } from '../../node_runtime/schema_builders.js'

// 本盒子的运行时字段契约；修改后同步开发结构说明。
export default { kind: "text", initial: { assets: [] }, output: object({
    "scenes": array(object({
      "id": string("稳定标识；已有对象保留原ID。", { minLength: 1 }),
      "name": string("对象名称。", { minLength: 1 }),
      "description": string("对象完整外观或环境身份描述。"),
      "layout": string("权威固定布局与建筑相对关系，不因机位变化改动。"),
      "materials": string("主要材质及色彩。"),
      "lighting": string("基础光源与光照；剧情中昼夜或天气变化由分片和Shot状态描述。"),
      "entrances_and_routes": string("出入口、区域连通关系及可通行路径。"),
      "fixed_landmarks": string("跨镜复用的固定参照及其名称。")
    }))
  }) }
