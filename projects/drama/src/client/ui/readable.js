// 字段标签与readable布局复制自meiji/client/content-forms.js，按drama节点契约补齐。
const fieldLabels = {
  shots: '分镜', name: '名称', title: '标题', body: '正文', description: '描述',
  world_background: '世界背景', key_anchors: '关键锚点', content: '内容', expression: '视听表达',
  characters_and_groups: '参与人物与群体', scene_and_space: '场景与空间', emotion_and_rhythm: '情绪与节奏',
  duration_seconds: '预估时长（秒）', continuity: '衔接', opening: '开场', ending: '结尾',
  social_role: '身份', age_range: '年龄段', nationality: '国籍或族群', gender: '性别', era: '年代',
  height: '身高', body_type: '体型', facial_features: '面部特征', hairstyle: '发型', voice: '声线',
  groups: '团队', group_ids: '所属团队', group_id: '团队', group_costume_id: '团队服装版本', story_segment_ids: '适用故事段',
  region: '地域与气候', appearance: '基本团队形象', demeanor: '群体气质', visual_identity: '视觉标识',
  relationships: '人物关系', signature_props: '标志性道具', immutable_traits: '不可改特征', costumes: '服装',
  layout: '固定布局', materials: '材质与色彩', lighting: '基础光照', entrances_and_routes: '出入口与路线', fixed_landmarks: '固定地标',
  previous_shot_connection: '前镜衔接', story_segment_id: '故事段', key_anchor_ids: '关键锚点', scene: '场景',
  scene_id: '场景 ID', state: '开场状态', spatial_setup: '空间关系', characters: '角色', character_id: '角色 ID',
  costume_id: '服装 ID', presence: '在场状态', position: '站位', facing: '朝向', gaze_target: '目光对象',
  beats: '节拍', action: '动作', camera: '摄影', scene_changes: '环境变化', effects: '特效', audio: '声音',
  clip_id: '分片 ID', clip_ids: '分片顺序', mode: '生成方式', sources: '来源镜头', shot_id: '镜头 ID', start_beat: '起始节拍', end_beat: '结束节拍',
  text_to_video: '文生视频', multimodal: '多模态', first_last_frame: '首尾帧', prompt: '提示词',
  integrated_multimodal_description: '完整视听描述', overall_soundscape: '整体声音', non_diegetic_music: '配乐',
  subject_definitions: '参考主体', summary: '摘要', retention_analysis: '素材保留特征', detailed_description: '详细视听描述', instruction: '首尾帧说明',
  address: '视频地址', server_address: '服务端地址', actual_duration_seconds: '实际时长（秒）', keyframes: '关键帧',
}
export function readable(value) {
  if (Array.isArray(value)) return value.map((item, i) => `${i + 1}. ${readable(item)}`).join('\n\n')
  if (value && typeof value === 'object') return Object.entries(value)
    .filter(([key, v]) => !['id', 'node_state'].includes(key) && v !== '' && v != null && (!Array.isArray(v) || v.length))
    .map(([key, v]) => {
      if (key === 'costumes' && Array.isArray(v)) {
        const entries = v.map((item, index) => {
          const parts = item && typeof item === 'object' && !Array.isArray(item) ? [item.name, item.description] : [readable(item)]
          const text = parts.filter(part => part != null && String(part).trim()).map(part => String(part).replace(/\s*\n\s*/g, ' ').trim()).join('，')
          return `${index + 1}. ${text}`
        }).join('；')
        return `${fieldLabels[key]}：${entries}`
      }
      return `${fieldLabels[key] || key}：${readable(v)}`
    }).join('\n')
  return String(value ?? '')
}

