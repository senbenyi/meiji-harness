import { review_output, image_output } from './shared_output_contracts.js'
import basic_info from '../node_box/project/definition.js'
import script_revision from '../node_box/script_revision/definition.js'
import story_segments from '../node_box/story_segments/definition.js'
import character_extraction from '../node_box/character_extraction/definition.js'
import scene_extraction from '../node_box/scene_extraction/definition.js'
import shot_design from '../node_box/shot_design/definition.js'
import video_prompt from '../node_box/video_prompt/definition.js'
import costume_image from '../node_box/costume_image/definition.js'
import scene_image from '../node_box/scene_image/definition.js'

// 仅汇总各盒子定义；对外保持原节点名称与JSON Pointer路径。
export const nodeDefinitions = {
  $defs: {
    review_output: review_output,
    image_output: image_output,
  },
  basic_info,
  script_revision,
  story_segments,
  character_extraction,
  scene_extraction,
  shot_design,
  video_prompt,
  costume_image,
  scene_image,
}
