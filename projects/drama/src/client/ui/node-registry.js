import { panel as projectPanel } from '../../node_box/project/ui/panel/index.js'
import { panel as scriptPanel } from '../../node_box/script_revision/ui/panel/index.js'
import { conversation as projectConversation } from '../../node_box/project/ui/conversation/index.js'
import { conversation as scriptConversation } from '../../node_box/script_revision/ui/conversation/index.js'
import { panel as story_segmentsPanel } from '../../node_box/story_segments/ui/panel/index.js'
import { conversation as story_segmentsConversation } from '../../node_box/story_segments/ui/conversation/index.js'
import { panel as character_extractionPanel } from '../../node_box/character_extraction/ui/panel/index.js'
import { conversation as character_extractionConversation } from '../../node_box/character_extraction/ui/conversation/index.js'
import { panel as scene_extractionPanel } from '../../node_box/scene_extraction/ui/panel/index.js'
import { conversation as scene_extractionConversation } from '../../node_box/scene_extraction/ui/conversation/index.js'
import { panel as shot_designPanel } from '../../node_box/shot_design/ui/panel/index.js'
import { conversation as shot_designConversation } from '../../node_box/shot_design/ui/conversation/index.js'
import { panel as video_promptPanel } from '../../node_box/video_prompt/ui/panel/index.js'
import { conversation as video_promptConversation } from '../../node_box/video_prompt/ui/conversation/index.js'
import { panel as clip_videoPanel } from '../../node_box/clip_video/ui/panel/index.js'
import { conversation as clip_videoConversation } from '../../node_box/clip_video/ui/conversation/index.js'
import { panel as merge_videoPanel } from '../../node_box/merge_video/ui/panel/index.js'
import { conversation as merge_videoConversation } from '../../node_box/merge_video/ui/conversation/index.js'
import { panel as clip_compositionPanel } from '../../node_box/clip_composition/ui/panel/index.js'
import { conversation as clip_compositionConversation } from '../../node_box/clip_composition/ui/conversation/index.js'

const registry = {
  project: { panel: projectPanel, conversation: projectConversation },
  script_revision: { panel: scriptPanel, conversation: scriptConversation },
  story_segments: { panel: story_segmentsPanel, conversation: story_segmentsConversation },
  character_extraction: { panel: character_extractionPanel, conversation: character_extractionConversation },
  scene_extraction: { panel: scene_extractionPanel, conversation: scene_extractionConversation },
  shot_design: { panel: shot_designPanel, conversation: shot_designConversation },
  video_prompt: { panel: video_promptPanel, conversation: video_promptConversation },
  clip_video: { panel: clip_videoPanel, conversation: clip_videoConversation },
  merge_video: { panel: merge_videoPanel, conversation: merge_videoConversation },
  clip_composition: { panel: clip_compositionPanel, conversation: clip_compositionConversation },
}

export const productionStages = ['story_segments', 'character_extraction', 'scene_extraction', 'shot_design', 'video_prompt', 'clip_video', 'merge_video'].map(type => registry[type])
export function nodeUi(type) { return Object.hasOwn(registry, type) ? registry[type] : {} }
export function nodeUiForStage(key) { return productionStages.find(entry => entry.panel.key === key) }
