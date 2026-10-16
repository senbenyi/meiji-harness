import { element, showPanelDialog } from "./panel-dom.js";
export const fieldLabels = {
  name: "名称", position: "定位", age_range: "年龄段", body_type: "身材", hairstyle: "发型",
  signature_props: "签名道具", immutable_traits: "不可改特征", gender: "性别", nationality: "国籍",
  era: "年代", height: "身高", facial_features: "面相", voice: "声音", required_appearance: "必出",
  default_costume_id: "默认服装", costumes: "服装", characters: "角色", color: "颜色", material: "材质", props: "道具",
  number: "编号", sequence: "序号", duration_seconds: "参考时长（秒）", title: "标题", body: "正文", opinion: "修改意见",
  description: "描述", segments: "故事小段", shots: "镜头", causal: "因果衔接", plot: "本集剧情",
  shot_scale: "景别", hook: "钩子", continuity_transition: "连续性衔接", reference_anchor: "参考锚点",
  fixed_landmark: "固定地标", character_positions: "人物位置", departed_characters: "离场角色", lighting: "光位",
  audio_arrangement: "音频安排", narration: "旁白", sound_effects: "音效",
  aspect_ratio: "画幅", creative_direction: "创作方向", episode_requirements: "本集要求",
  reference_episode_duration_seconds: "参考单集时长（秒）", content: "内容",
  character_id: "角色 ID", costume_id: "服装 ID",
  on_screen_characters: "出镜角色", background_characters: "不具名群演描述", storyboard: "每秒分镜", dialogue: "对白", speaker_id: "说话人 ID",
  speaker_name: "说话人",  dialogue_text: "原话", mode: "方式", time_range: "时段",
  end_state: "结尾状态", pending_actions: "未完成动作", pending_dialogue: "未结束对白内容", continuing_audio: "持续声音",
  action: "动作", camera: "镜头", space: "空间", audio: "声音", handoff: "交接",
  integrated_multimodal_description: "综合描述", overall_soundscape: "整体声音", non_diegetic_music: "配乐",
};
const templates = {
  characters: { name: "", gender: "", era: "", position: "", age_range: "", body_type: "", hairstyle: "", signature_props: [], immutable_traits: [], costumes: [] },
  costumes: { name: "", color: "", material: "", props: [] },
  segments: { sequence: 1, duration_seconds: 10, body: "", causal: "" },
  shots: { title: "", id: "", duration_seconds: 10, shot_scale: "中景", hook: "揭示", body: "", continuity_transition: "", reference_anchor: { fixed_landmark: "", character_positions: "", departed_characters: "", lighting: "" }, audio_arrangement: { narration: "", dialogue: "", sound_effects: "" }, on_screen_characters: [], background_characters: "" },
  on_screen_characters: { character_id: "", costume_id: "" },
  storyboard: { time_range: "0–1s", action: "", camera: "", space: "", audio: "", handoff: "", dialogue: [] },
  dialogue: { speaker_id: "", speaker_name: "", mode: "画内", dialogue_text: "" },
};
export function fieldsForm(
  value,
  { disabled = false, templates: overrides = {} } = {},
) {
  const box = element("div", "", "image-text-grid");
  const render = (parent, key, initial) => {
    if (key === 'id') return () => initial;
    if (Array.isArray(initial)) {
      const section = element("section", "", "image-text-wide"),
        heading = element("div", "", "image-text-head"),
        rows = element("div"),
        readers = [];
      heading.append(element("h4", fieldLabels[key] || key));
      section.append(heading, rows);
      parent.append(section);
      const add = (item) => {
        const row = element("fieldset", "", "overview-card");
        const entry = render(row, "", item);
        const remove = element("button", "移除");
        remove.type = "button";
        remove.disabled = disabled;
        remove.onclick = () => {
          readers.splice(readers.indexOf(entry), 1);
          row.remove();
        };
        row.append(remove);
        rows.append(row);
        readers.push(entry);
      };
      initial.forEach(add);
      const plus = element("button", "＋ 添加" + (fieldLabels[key] || key));
      plus.type = "button";
      plus.disabled = disabled;
      plus.onclick = () =>
        add(structuredClone(overrides[key] ?? templates[key] ?? ""));
      heading.append(plus);
      return () => readers.map((read) => read());
    }
    if (initial && typeof initial === "object") {
      const section = element("div", "", "image-text-grid image-text-wide");
      if (key) section.append(element("h4", fieldLabels[key] || key, "image-text-wide"));
      parent.append(section);
      const entries = Object.entries(initial).map(([name, v]) => [
        name,
        render(section, name, v),
      ]);
      return () =>
        Object.fromEntries(entries.map(([name, read]) => [name, read()]));
    }
    const label = element("label"),
      caption = element("span", fieldLabels[key] || key, "image-text-key");
    const options = {
      aspect_ratio: ["1344x768", "768x1344"],
      scope: ["project", "node"],
      category: ["动作", "表情", "武术", "特效", "声音", "对白", "配乐", "其他"],
      constraint: ["必须", "参考"],
      出镜: ["出镜", "仅声音"],
      mode: ["画内", "画外", "心声"],
    };
    const input = element(
      options[key]
        ? "select"
        : typeof initial === "boolean"
          ? "input"
          : /正文|描述|方向|要求|意见|动作|镜头|空间|声音|交接|原话|表演|内容|体型|面相|身份特征|事件|结尾状态/.test(
                fieldLabels[key] || key,
              ) && typeof initial !== "number"
            ? "textarea"
            : "input",
    );
    if (options[key])
      for (const text of options[key]) {
        const o = element("option", text);
        o.value = text;
        input.append(o);
      }
    if (typeof initial === "boolean") {
      input.type = "checkbox";
      input.checked = initial;
    } else {
      if (typeof initial === "number") {
        input.type = "number";
        input.step = "any";
      }
      input.value = initial ?? "";
    }
    if (input.tagName === "TEXTAREA") {
      input.rows = 4;
      label.className = "image-text-wide";
    }
    input.name = key;
    input.setAttribute("aria-label", fieldLabels[key] || key || "内容");
    input.disabled = disabled;
    label.append(caption, input);
    parent.append(label);
    return () =>
      typeof initial === "boolean"
        ? input.checked
        : typeof initial === "number"
          ? input.value.trim() === ""
            ? (() => {
                throw Error(key + "不能为空");
              })()
            : Number(input.value)
          : input.value;
  };
  const read = render(box, "", value);
  return { box, read };
}
export function editor(
  root,
  title,
  value,
  save,
  { json = true, disabled = false, templates, textField = 'body', submitLabel = '保存' } = {},
) {
  const dialog = element("dialog"),
    head = element("div", "", "modal-head"),
    close = element("button", "×", "cancel"),
    form = element("form", "", "edit image-text-editor"),
    error = element("div", "", "error"),
    footer = element("footer", "", "footer"),
    cancel = element("button", "取消", "cancel"),
    submit = element("button", submitLabel, "primary");
  head.append(element("h2", title), close);
  close.type = cancel.type = "button";
  close.setAttribute("aria-label", "关闭" + title);
  close.onclick = cancel.onclick = () => dialog.close();
  error.setAttribute("role", "alert");
  submit.type = "submit";
  submit.disabled = disabled;
  const fields = fieldsForm(json ? value : { [textField]: String(value) }, {
    disabled,
    templates,
  });
  form.append(fields.box, error, footer);
  footer.append(cancel, submit);
  dialog.append(head, form);
  form.onsubmit = async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      const result = fields.read();
      await save(json ? result : result[textField]);
      dialog.close();
    } catch (cause) {
      error.textContent = cause.message;
    } finally {
      submit.disabled = disabled;
    }
  };
  root.append(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  showPanelDialog(dialog);
  return dialog;
}
export function readable(value) {
  if (Array.isArray(value))
    return value.map((item, i) => `${i + 1}. ${readable(item)}`).join("\n\n");
  if (value && typeof value === "object")
    return Object.entries(value)
      .filter(([, v]) => v !== "" && v != null)
      .map(([key, v]) => `${fieldLabels[key] || key}：${readable(v)}`)
      .join("\n");
  return String(value ?? "");
}
