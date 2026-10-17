import { sceneText, sceneImageContext } from '../../shared/scene-inputs.js';
import { videoPack, previousShot, videoImages } from '../../shared/video-inputs.js';
import { shotReferenceBindings } from '../../shared/shot-text-inputs.js';
import { primaryCostumeImage } from "../../shared/models/character_model.js";
import { dataUrl } from "../gateway/model-gateway.js";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { nodeOf, locateTarget, invalid } from "../../shared/task_contract.js";
import { aiProjection } from "./content.js";
import { saveLastFrame } from "../media/extract-video-tail.js";
import { concatFilms } from "../media/concat-videos.js";
import { decodeImageData } from "../media/decode-image-data.js";
import { normalizeVideo } from "../media/normalize-video.js";
// 实际时长按成片文件测得，保留一位小数。
const seconds = (value) => Math.round((Number(value) || 0) * 10) / 10;
// 图片提示词的人物资料组装为一句话，省略编号、必出等非画面字段及缺失值。
const missing = (v) =>
  typeof v !== "string" || !v.trim() || /^(资料)?未提供$|^未知$|^无$/.test(v.trim());
export function personSentence(person) {
  const pick = (v, format = (x) => x) => (missing(v) ? "" : format(v.trim()));
  const parts = [
    pick(person.name), pick(person.gender), pick(person.era), pick(person.position), pick(person.age_range),
    pick(person.body_type, (value) => `身材${value}`),
    pick(person.hairstyle, (value) => `发型${value}`),
    pick(person.facial_features, (value) => `面部${value}`),
    pick(person.height, (value) => `身高${value}`),
    pick(person.nationality, (value) => `国籍${value}`),
    pick(person.signature_props.filter(value => !missing(value)).join("；"), (value) => `签名道具${value}`),
    pick(person.immutable_traits.filter(value => !missing(value)).join("；"), (value) => `不可改特征${value}`),
  ].filter(Boolean);
  return parts.length ? `${parts.join("；")}。` : "";
}
export function createMediaHandler({ media, ai, readLanguage = async () => 'zh-CN' }) {
  return async ({ snapshot, task, step, draft, signal, record }) => {
    const language = await readLanguage();
    const p = snapshot.project,
      { object, episode, character } = locateTarget(
        p,
        task.business_type,
        task.target_id,
      ),
      business = task.business_type,
      node = nodeOf(p, business, task.target_id);
    if (step.kind === "precheck" && business === "assembly") {
      for (const shot of episode.shot_list.shots)
        await media.validate(shot.video.address, p.id, "video");
      signal.throwIfAborted();
      return { result: { passed: true } };
    }
    if (business === 'video' && step.kind === 'apply') {
      const info = await media.validate(draft.address, p.id, 'video');
      const temp = await mkdtemp(join(tmpdir(), 'meiji-video-tail-'));
      try {
        const frame = await saveLastFrame(media.path(draft.address, p.id), join(temp, 'tail.png'), signal);
        signal.throwIfAborted();
        const tail = await media.put(p.id, frame, 'png', signal);
        signal.throwIfAborted();
        const content = { ...draft, actual_duration_seconds: seconds(info.duration), last_frame: { address: tail.address } };
        return { content, result: { address: content.address, duration: content.actual_duration_seconds, last_frame: tail.address } };
      } finally { await rm(temp, { recursive: true, force: true }); }
    }
    let bytes,
      prompt = null,
      referenceIds = [];
    if (task.action === "manual_edit") {
      const input = step.result?.input;
      if (input?.data) {
        if (["video", "assembly"].includes(business)) {
          const match = /^data:video\/mp4;base64,([A-Za-z0-9+/=]+)$/.exec(
            input.data,
          );
          if (!match) invalid("视频", "需为 MP4 文件");
          bytes = Buffer.from(match[1], "base64");
        } else bytes = decodeImageData(input.data, input.mime).bytes;
      } else {
        const info = await media.validate(
          input?.address,
          p.id,
          ["video", "assembly"].includes(business) ? "video" : "image",
        );
        return {
          content: {
            address: input.address,
            ...(["video", "assembly"].includes(business) ? { actual_duration_seconds: seconds(info.duration) } : {}),
          },
        };
      }
    } else if (business === 'assembly') {
      const temp = await mkdtemp(join(tmpdir(), 'meiji-media-step-'));
      try {
        const output = join(temp, 'film.mp4');
        const inputs = [...episode.shot_list.shots].sort((a,b) => a.sequence-b.sequence).map(shot => media.path(shot.video.address, p.id));
        await concatFilms({ inputs, output });
        signal.throwIfAborted(); bytes = await readFile(output);
      } finally { await rm(temp, { recursive: true, force: true }); }
    } else if (business === 'scene-image') {
      const references = [];
      if (node.address) {
        await media.validate(node.address,p.id,'image');
        references.push(dataUrl(await media.read(node.address,p.id), node.address.endsWith('.jpg') ? 'image/jpeg' : node.address.endsWith('.webp') ? 'image/webp' : 'image/png'));
      }
      const response = await ai(business, task.opinion.trim() ? 'regenerate' : 'generate', { language, requirements:p.creative_direction, scene:sceneText(object), context:sceneImageContext(p,object.id), aspectRatio:p.aspect_ratio, references, ...(task.opinion.trim() ? {opinion:task.opinion} : {}) }, {signal,record,task,step});
      bytes = Buffer.from(response.result.data,'base64'); prompt = response.prompt;
    } else if (business === "costume-image") {
      const modify = Boolean(node.address) && Boolean(task.opinion.trim());
      const person = character, primary = primaryCostumeImage(person);
      const first = primary.costume_id === (object?.id || '');
      const reference = first ? person.reference_image.address : primary.address;
      const references = [];
      if (reference) {
        await media.validate(reference, p.id, 'image');
        references.push(dataUrl(await media.read(reference, p.id), reference.endsWith('.webp') ? 'image/webp' : reference.endsWith('.jpg') ? 'image/jpeg' : 'image/png'));
      }
      const response = await ai(business, modify ? 'regenerate' : 'generate', {
        language,
        requirements: '',
        person: personSentence(person),
        costume: object ? [object.name, object.color, object.material, ...object.props].filter(Boolean).join('，') : '',
        referenceDescription: reference ? first ? '参考图用于人物身份和面相，服装按本次资料。' : '参考图为第一套定妆照，保持人物身份、面相和体型，服装按本次资料。' : '',
        aspectRatio: p.aspect_ratio,
        references,
        ...(modify ? { opinion: task.opinion } : {}),
      }, { signal, record, task, step });
      bytes = Buffer.from(response.result.data, 'base64');
      prompt = response.prompt;
      prompt.parameters = { reference_count: references.length, reference_address: reference || null, aspectRatio: p.aspect_ratio };
      await record({ prompt });
    } else if (business === "video") {
      const type = object.video_generation_type, pack = videoPack(type);
      const packed = pack ? nodeOf(p, pack, object.id) : null;
      const refs = [];
      let firstFrame;
      if (type === '多模态') {
        referenceIds = videoImages(p, object).map(row => row.id);
        for (const row of packed.reference_images) {
          await media.validate(row.address, p.id, 'image');
          refs.push(dataUrl(await media.read(row.address, p.id), row.address.endsWith('.jpg') ? 'image/jpeg' : row.address.endsWith('.webp') ? 'image/webp' : 'image/png'));
        }
      } else if (type === '首尾帧') {
        await media.validate(packed.input_reference, p.id, 'image');
        firstFrame = dataUrl(await media.read(packed.input_reference, p.id), 'image/png');
      }
      const prev = previousShot(episode, object);
      const opinion = step.kind === 'revise' ? snapshot.steps.filter(row => row.task_id === task.id && row.kind === 'review' && row.step_status === 'rejected' && row.seq < step.seq).sort((a,b) => b.seq-a.seq)[0]?.result?.原因 : task.opinion;
      const modify = Boolean(opinion?.trim());
      const response = await ai(business, modify ? 'regenerate' : 'generate', {
        type,
        textPrompt: aiProjection(object.text_to_video_prompt),
        duration: object.duration_seconds,
        aspectRatio: p.aspect_ratio,
        ...(packed ? { packedPrompt: packed.prompt } : {}),
        ...(refs.length ? {
          referenceImages: refs,
          referenceBindings: shotReferenceBindings(p, episode, object),
        } : firstFrame ? { firstFrame } : {}),
        ...(modify ? { opinion } : {}),
      }, { signal, record, task, step });
      bytes = Buffer.from(response.result.data, 'base64');
      prompt = response.prompt;
      prompt.parameters = { ...prompt.parameters, duration: object.duration_seconds, aspectRatio: p.aspect_ratio, reference_ids: referenceIds, first_frame: firstFrame ? prev.last_frame.address : null };
      await record({ prompt });
    } else invalid("媒体", "未知业务");
    if (["video", "assembly"].includes(business) && task.action !== "manual_edit")
      bytes = await normalizeVideo(bytes, p.aspect_ratio, signal);
    signal.throwIfAborted();
    const ext = ["video", "assembly"].includes(business)
        ? "mp4"
        : bytes[0] === 0xff && bytes[1] === 0xd8
          ? "jpg"
          : bytes.subarray(0, 4).toString() === "RIFF"
            ? "webp"
            : "png",
      asset = await media.put(p.id, bytes, ext, signal);
    signal.throwIfAborted();
    return {
      content: {
        address: asset.address,
        ...(["video", "assembly"].includes(business) ? { actual_duration_seconds: seconds(asset.duration) } : {}),
      },
      result: {
        address: asset.address,
        ...(["video", "assembly"].includes(business) ? { duration: asset.duration } : {}),
        reference_ids: referenceIds,
        ...(prompt?.parameters?.remote_id
          ? { remote_id: prompt.parameters.remote_id }
          : {}),
      },
      prompt,
    };
  };
}
