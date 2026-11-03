export const projectFields = {
  name: { type: 'string', minLength: 1, maxLength: 100, description: '用户指定的短剧名称' },
  creation_mode: { type: 'string', enum: ['剧本', '自由创作'], default: '剧本' },
  aspect_ratio: { type: 'string', enum: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], default: '9:16' },
  reference_episode_duration_seconds: { type: 'integer', minimum: 1, maximum: 86400, default: 180 },
  original_script_filename: { type: 'string', description: '本地或素材库剧本的原始文件名，未提供使用剧本.txt' },
  original_script: { type: 'string', description: '创建入参中的剧本正文；保存时写入不可变文件，短剧source.revisions保存引用；未提供留空' },
}
