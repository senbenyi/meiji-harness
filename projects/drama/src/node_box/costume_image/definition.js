import { image_output } from '../../node_runtime/shared_output_contracts.js'

// 本盒子的运行时字段契约；修改后同步开发结构说明。
export default { kind: "image", initial: { reference_image: "", aspect_ratio: "", address: "" }, output: image_output }
