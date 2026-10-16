import { locateTarget, invalid } from '../../shared/task_contract.js';
import { previousShot, videoType, videoPack, videoImages } from '../../shared/video-inputs.js';
import { videoRequest } from '../http/video-request.js';
import { videoPayload } from '../http/llm-server/params.js';
import { videoSizeOf } from '../../shared/media-parameters.js';
import { shotTextInputs } from '../../shared/shot-text-inputs.js';
import { aiProjection } from './content.js';
import { dataUrl } from '../gateway/model-gateway.js';

export function createVideoPromptHandler({ media }) {
  return async ({ snapshot, task, signal }) => {
    const project = snapshot.project, { object: shot, episode } = locateTarget(project, task.business_type, task.target_id);
    const type = videoType(episode, shot);
    if (videoPack(type) !== task.business_type) invalid('视频编排', '当前类型不适用此编排');
    const addresses = type === '首尾帧' ? [previousShot(episode, shot).last_frame.address] : videoImages(project, shot).map(({ image }) => image.address);
    const images = [];
    for (const address of addresses) {
      await media.validate(address, project.id, 'image');
      images.push(dataUrl(await media.read(address, project.id), address.endsWith('.jpg') ? 'image/jpeg' : address.endsWith('.webp') ? 'image/webp' : 'image/png'));
    }
    signal.throwIfAborted();
    const participants = type === '多模态' ? shotTextInputs(project, episode, shot, 'storyboard').characters : [];
    const referenceBindings = shot.on_screen_characters.map(row => {
      const person = participants.find(person => person.id === row.character_id);
      const costume = person?.costumes.find(costume => costume.id === row.costume_id);
      return { name: person?.name || '', speaker_tag: person?.speaker_tag || '', costume: costume ? [costume.name, costume.description, costume.color, costume.material, ...costume.props].filter(Boolean).join('，') : '' };
    });
    if (type === '多模态' && shot.scene_id) {
      const scene = project.scene_library.scenes.find(item => item.id === shot.scene_id);
      referenceBindings.push({kind:'scene', name:scene.name, description:[scene.description,scene.layout,scene.materials,scene.lighting].filter(Boolean).join('；'), state:shot.scene_state});
    }
    const request = videoRequest({ type, textPrompt: aiProjection(shot.text_to_video_prompt), duration: shot.duration_seconds, aspectRatio: project.aspect_ratio,
      ...(type === '首尾帧' ? { firstFrame: images[0] } : { referenceImages: images, referenceBindings }) });
    const body = videoPayload({ model: 'MiniMax-H3', ...request });
    // 文件地址保存到 Model；发送时按地址读取数据，避免将 Base64 重复写进项目。
    const content = { model: body.model, prompt: body.prompt, seconds: body.duration, size: videoSizeOf(project.aspect_ratio),
      ...(type === '首尾帧' ? { input_reference: addresses[0] } : { reference_images: addresses.map(address => ({ address })) }) };
    return { content, result: content };
  };
}
