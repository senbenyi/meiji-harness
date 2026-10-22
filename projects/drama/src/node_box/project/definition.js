import { string, number, object } from '../../node_runtime/schema_builders.js'

// basic_info节点的AI输出；项目名称、原稿等输入资料不属于output。
export default { kind: 'text', output: object({
  summary: string('当前项目剧本的剧情摘要，概括主要人物、冲突、发展与结局，不添加原稿未提供的信息。', { minLength: 1 }),
  estimated_duration_seconds: number('完整剧本按正常表演节奏呈现的预估总时长，单位秒；综合对白、动作、停顿与转场估计，不照抄参考单集时长。', { exclusiveMinimum: 0 }),
}) }
