import { dataUrl } from "../gateway/model-gateway.js";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadTemplate,
  renderTemplate,
  ruleInputs,
  languageName,
} from "../prompts/yaml-prompts.js";
import { nodeOf, locateTarget, invalid } from "../../shared/task-contract.js";
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
  const basics = [
      pick(person.名称),
      pick(person.性别),
      pick(person.年龄),
      pick(person.国籍, (x) => (/[人族]$/.test(x) ? x : `${x}人`)),
      pick(person.年代),
      pick(person.身份),
    ].filter(Boolean),
    looks = [
      pick(person.身高, (x) => `身高${x}`),
      pick(person.体型, (x) => `体型${x}`),
      pick(person.面相, (x) => `面相${x}`),
    ].filter(Boolean),
    parts = [basics.join("，"), pick(person.身份特征), looks.join("，")].filter(
      Boolean,
    );
  return parts.length ? `${parts.join("；")}。` : "";
}
export function createMediaHandler({ media, gateway }) {
  return async ({ snapshot, task, step, signal, record }) => {
    const p = snapshot.project,
      { object, episode, character } = locateTarget(
        p,
        task.business_type,
        task.target_id,
      ),
      business = task.business_type,
      node = nodeOf(p, business, task.target_id);
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
          input?.地址,
          p.id,
          ["video", "assembly"].includes(business) ? "video" : "image",
        );
        return {
          content: {
            地址: input.地址,
            ...(["video", "assembly"].includes(business) ? { 实际时长秒: seconds(info.duration) } : {}),
          },
        };
      }
    } else if (["tail", "assembly"].includes(business)) {
      const temp = await mkdtemp(join(tmpdir(), "meiji-media-step-"));
      try {
        const output = join(
          temp,
          business === "tail" ? "tail.png" : "film.mp4",
        );
        if (business === "tail") {
          await media.validate(object.视频.地址, p.id, "video");
          await saveLastFrame(media.path(object.视频.地址, p.id), output);
        } else {
          const inputs = [];
          for (const s of [...episode.镜头表.镜头].sort(
            (a, b) => a.序号 - b.序号,
          )) {
            await media.validate(s.视频.地址, p.id, "video");
            inputs.push(media.path(s.视频.地址, p.id));
          }
          await concatFilms({ inputs, output });
        }
        signal.throwIfAborted();
        bytes = await readFile(output);
      } finally {
        await rm(temp, { recursive: true, force: true });
      }
    } else if (["character-image", "costume-image"].includes(business)) {
      const hasOriginal = Boolean(node.地址),
        modify = hasOriginal && Boolean(task.opinion.trim()),
        template = await loadTemplate(
          `${business}-${modify ? "regenerate" : "generate"}`,
        );
      const person = business === "character-image" ? object : character,
        identity = personSentence(person);
      const reference = modify
        ? node.地址
        : business === "character-image"
          ? object.参考图.地址
          : character.图片.地址;
      prompt = renderTemplate(template, {
        输出语言: languageName(p.输出语言),
        人物资料: identity,
        本套服装描述: business === "costume-image" ? object.描述 : "",
        参考图片说明: reference
          ? business === "character-image"
            ? "参考图是用户提供的人物参考，只用于确定面相，不沿用其中的衣着、姿势、背景或表情。身材和肌肉以人物资料为准。"
            : "参考图是该角色的角色图，是本次生成的固定且唯一参考。用于保持角色身份、脸、体型和不可改特征。生成结果必须穿着这一套服装。"
          : "",
        修改意见: task.opinion,
        ...ruleInputs(p.规则, business, task.target_id),
      });
      const references = [];
      if (reference) {
        await media.validate(reference, p.id, "image");
        references.push({
          mime: reference.endsWith(".webp")
            ? "image/webp"
            : reference.endsWith(".jpg")
              ? "image/jpeg"
              : "image/png",
          bytes: await media.read(reference, p.id),
        });
      }
      prompt.parameters = {
        reference_count: references.length,
        reference_address: reference || null,
        aspectRatio: p.画幅,
      };
      await record({ prompt });
      bytes = await gateway.image({
        prompt: prompt.body,
        aspectRatio: p.画幅,
        references,
        signal,
        trace: prompt,
        record,
      });
    } else if (business === "video") {
      const refs = [];
      for (const row of object.出镜角色) {
        const c = p.角色库.角色.find((c) => c.id === row.角色id),
          co = c.服装.find((co) => co.id === row.服装id),
          chosen = co || c;
        if (chosen.图片.状态 !== "generated")
          invalid("视频参考图", "角色或服装图片尚未有效生成");
        if (referenceIds.includes(chosen.id)) continue;
        await media.validate(chosen.图片.地址, p.id, "image");
        refs.push(
          `data:${chosen.图片.地址.endsWith(".jpg") ? "image/jpeg" : chosen.图片.地址.endsWith(".webp") ? "image/webp" : "image/png"};base64,${(await media.read(chosen.图片.地址, p.id)).toString("base64")}`,
        );
        referenceIds.push(chosen.id);
      }
      if (refs.length > 9) invalid("视频参考图", "最多9张参考图");
      const shots = [...episode.镜头表.镜头].sort((a, b) => a.序号 - b.序号),
        prev = shots[shots.findIndex((s) => s.id === object.id) - 1];
      let firstFrame;
      if (prev) {
        await media.validate(prev.尾帧.地址, p.id, "image");
        firstFrame = dataUrl(
          await media.read(prev.尾帧.地址, p.id),
          "image/png",
        );
      }
      const template = await loadTemplate(
        `video-${task.opinion.trim() ? "regenerate" : "generate"}`,
      );
      prompt = renderTemplate(template, {
        输出语言: languageName(p.输出语言),
        文本提示词: aiProjection(object.文本提示词, p),
        参考图片用途说明: referenceIds.map(
          (id, i) =>
            `Picture ${i + 1}：${p.角色库.角色.find((c) => c.id === id)?.名称 || p.角色库.角色.flatMap((c) => c.服装).find((co) => co.id === id)?.名称}`,
        ),
        开场衔接: prev ? aiProjection(prev.每秒分镜, p) : "首镜，无上一镜",
        修改意见: task.opinion,
        ...ruleInputs(p.规则, business, task.target_id),
      });
      prompt.parameters = {
        duration: object.时长秒,
        aspectRatio: p.画幅,
        reference_ids: referenceIds,
        first_frame: prev?.尾帧.地址 || null,
      };
      await record({ prompt });
      const remote = await gateway.submitVideo({
        prompt: prompt.body,
        duration: object.时长秒,
        aspectRatio: p.画幅,
        mode: refs.length ? "reference" : firstFrame ? "first_frame" : "text",
        inputReference: firstFrame,
        referenceImages: refs,
        signal,
        trace: prompt,
        record,
      });
      await record({ result: { remote_id: remote.id } });
      bytes = await gateway.retrieveVideo({
        promptId: remote.id,
        signal,
        trace: prompt,
        record,
      });
      prompt.parameters.remote_id = remote.id;
    } else invalid("媒体", "未知业务");
    if (["video", "assembly"].includes(business) && task.action !== "manual_edit")
      bytes = await normalizeVideo(bytes, p.画幅, signal);
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
        地址: asset.address,
        ...(["video", "assembly"].includes(business) ? { 实际时长秒: seconds(asset.duration) } : {}),
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
