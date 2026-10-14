import { locateTarget, invalid } from '../../shared/task_contract.js';
import { previousShot, videoType, videoPack, videoImages } from '../../shared/video-inputs.js';
import { videoRequest } from '../http/video-request.js';
import { videoParameters } from '../http/elysium/video-params.js';
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
    const request = videoRequest({ type, textPrompt: aiProjection(shot.text_to_video_prompt), duration: shot.duration_seconds, aspectRatio: project.aspect_ratio,
      ...(type === '首尾帧' ? { firstFrame: images[0] } : { referenceImages: images }) });
    const body = videoParameters({ model: 'elysium-video', ...request });
    // 文件地址保存到 Model；发送时按地址读取数据，避免将 Base64 重复写进项目。
    const content = { model: body.model, prompt: body.prompt, seconds: Number(body.seconds), size: body.size,
      ...(type === '首尾帧' ? { input_reference: addresses[0] } : { reference_images: addresses.map(address => ({ address })) }) };
    return { content, result: content };
  };
}
