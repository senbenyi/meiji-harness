import { createId } from '../task_contract.js';

export const emptyBasicInfoModel = (fields = {}) => ({
  id: createId('project'), name: '', creation_mode: '剧本', aspect_ratio: '9:16',
  creative_requirements: '', reference_episode_duration_seconds: 150, original_script: '',
  ...fields,
});
