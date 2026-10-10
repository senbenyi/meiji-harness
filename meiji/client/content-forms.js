import { element, showPanelDialog } from "./panel-dom.js";
const templates = {
  角色: { 角色编号: "", 出镜: "出镜" },
  服装: { 编号: "", 名称: "", 描述: "" },
  小段: { 序号: 1, 时长秒: 10, 正文: "" },
  镜头: { 序号: 1, 编号: "S01", 时长秒: 10, 标题: "", 正文: "", 出镜角色: [] },
  出镜角色: { 角色编号: "", 服装编号: "" },
  节拍: {
    开始秒: 0,
    结束秒: 1,
    动作: "",
    镜头: "",
    空间: "",
    声音: "",
    交接: "",
    对白: [],
  },
  对白: { 说话人编号: "", 方式: "画内", 原话: "", 表演: "" },
  环境声: { 开始秒: 0, 结束秒: 1, 正文: "" },
  配乐: { 开始秒: 0, 结束秒: 1, 正文: "" },
  适用业务: "",
  正文: {
    开始秒: 0,
    结束秒: 1,
    动作: "",
    镜头: "",
    空间: "",
    同步声音: "",
    对白: "",
    心声: "",
    结尾状态: "",
  },
  心声: { 说话人编号: "", 原话: "", 表演: "" },
  规则: {
    范围: "project",
    适用业务: [],
    节点编号: "",
    类别: "其他",
    约束: "参考",
    内容: "",
  },
};
export function fieldsForm(
  value,
  { disabled = false, templates: overrides = {} } = {},
) {
  const box = element("div", "", "image-text-grid");
  const render = (parent, key, initial) => {
    if (Array.isArray(initial)) {
      const section = element("section", "", "image-text-wide"),
        heading = element("div", "", "image-text-head"),
        rows = element("div"),
        readers = [];
      heading.append(element("h4", key));
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
      const plus = element("button", "＋ 添加" + key);
      plus.type = "button";
      plus.disabled = disabled;
      plus.onclick = () =>
        add(structuredClone(overrides[key] ?? templates[key] ?? ""));
      heading.append(plus);
      return () => readers.map((read) => read());
    }
    if (initial && typeof initial === "object") {
      const section = element("div", "", "image-text-grid image-text-wide");
      if (key) section.append(element("h4", key, "image-text-wide"));
      parent.append(section);
      const entries = Object.entries(initial).map(([name, v]) => [
        name,
        render(section, name, v),
      ]);
      return () =>
        Object.fromEntries(entries.map(([name, read]) => [name, read()]));
    }
    const label = element("label"),
      caption = element("span", key, "image-text-key");
    const options = {
      画幅: ["1344x768", "768x1344"],
      输出语言: ["zh-CN", "en"],
      范围: ["project", "node"],
      类别: ["动作", "表情", "武术", "特效", "声音", "对白", "配乐", "其他"],
      约束: ["必须", "参考"],
      出镜: ["出镜", "仅声音"],
      方式: ["画内", "画外", "心声"],
    };
    const input = element(
      options[key]
        ? "select"
        : typeof initial === "boolean"
          ? "input"
          : /正文|描述|方向|要求|动作|镜头|空间|声音|交接|原话|表演|内容|体型|面相|身份特征|事件|结尾状态/.test(
                key,
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
    input.setAttribute("aria-label", key || "内容");
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
  { json = true, disabled = false, templates } = {},
) {
  const dialog = element("dialog"),
    head = element("div", "", "modal-head"),
    close = element("button", "×", "cancel"),
    form = element("form", "", "edit image-text-editor"),
    error = element("div", "", "error"),
    footer = element("footer", "", "footer"),
    cancel = element("button", "取消", "cancel"),
    submit = element("button", "保存", "primary");
  head.append(element("h2", title), close);
  close.type = cancel.type = "button";
  close.setAttribute("aria-label", "关闭" + title);
  close.onclick = cancel.onclick = () => dialog.close();
  error.setAttribute("role", "alert");
  submit.type = "submit";
  submit.disabled = disabled;
  const fields = fieldsForm(json ? value : { 正文: String(value) }, {
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
      await save(json ? result : result.正文);
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
      .map(([key, v]) => `${key}：${readable(v)}`)
      .join("\n");
  return String(value ?? "");
}
