import { element, showPanelDialog } from "./panel-dom.js";
import { request } from "./task-client.js";
export function projectDialog(root, save) {
  const dialog = element("dialog");
  dialog.id = "create-project";
  dialog.setAttribute("aria-labelledby", "create-title");
  const head = element("div", "", "modal-head"),
    title = element("h2", "创建短视频项目");
  title.id = "create-title";
  const close = element("button", "×", "cancel");
  close.setAttribute("aria-label", "关闭创建弹窗");
  close.onclick = () => dialog.close();
  head.append(title, close);
  const form = element("form", "", "create");
  const field = (text, id, input) => {
    const label = element("label", text);
    label.htmlFor = id;
    input.id = id;
    form.append(label, input);
    return input;
  };
  const mode = field("创作模式", "project-mode", element("select"));
  mode.name = "mode";
  for (const [v, t] of [
    ["script", "剧本模式"],
    ["free", "自由模式"],
  ]) {
    const o = element("option", t);
    o.value = v;
    mode.append(o);
  }
  const scriptGroup = element("div", "", "create-script-fields"),
    row = element("div", "", "workflow-generation-row"),
    imp = element("button", "导入剧本", "script-import"),
    choose = element("button", "从素材库选择剧本", "script-choose"),
    clear = element("button", "移除剧本", "script-clear"),
    file = element("input"),
    picker = element("select", "", "script-picker"),
    selected = element("div", "", "meta script-selected");
  file.type = "file";
  file.accept = ".txt,.text,.md";
  file.hidden = true;
  file.setAttribute("aria-label", "导入剧本文件");
  picker.id = "project-script";
  picker.setAttribute("aria-label", "选择剧本");
  picker.hidden = clear.hidden = true;
  for (const b of [imp, choose, clear]) b.type = "button";
  row.append(imp, choose, clear);
  scriptGroup.append(element("label", "剧本"), row, file, picker, selected);
  form.append(scriptGroup);
  const name = field("短剧标题", "title", element("input"));
  name.name = "title";
  name.required = true;
  name.maxLength = 100;
  name.placeholder = "给这个故事起个名字";
  name.autofocus = true;
  const aspect = field("画幅", "aspect", element("select"));
  aspect.name = "aspect";
  for (const v of ["1344x768", "768x1344"]) {
    const o = element("option", v);
    o.value = v;
    aspect.append(o);
  }
  const premiseGroup = element("div", "", "create-premise-fields"),
    label = element("label", "AI 创作方向（必填）"),
    premise = element("textarea");
  label.htmlFor = "project-premise";
  premise.id = "project-premise";
  premise.name = "premise";
  premise.maxLength = 1000;
  premise.placeholder = "填写题材、人物、核心冲突与故事方向，最多1000字";
  premiseGroup.append(label, premise);
  form.append(premiseGroup);
  const error = element("div", "", "error");
  error.setAttribute("role", "alert");
  const footer = element("footer", "", "footer"),
    cancel = element("button", "取消", "cancel"),
    submit = element("button", "创建项目", "primary");
  cancel.type = "button";
  submit.type = "submit";
  cancel.onclick = () => dialog.close();
  footer.append(cancel, submit);
  form.append(error, footer);
  dialog.append(
    head,
    element(
      "p",
      "选择创作模式，填写标题和画幅。自由模式填写创作方向，剧本模式导入剧本。",
    ),
    form,
  );
  let text = "",
    ticket = 0;
  const active = () => dialog.isConnected;
  const set = (filename, body) => {
    text = body;
    selected.textContent = filename;
    clear.hidden = !body;
    if (!name.value) name.value = filename.replace(/\.(txt|text|md)$/i, "");
  };
  mode.onchange = () => {
    scriptGroup.hidden = mode.value !== "script";
    premiseGroup.hidden = mode.value !== "free";
    premise.required = mode.value === "free";
    premise.disabled = mode.value !== "free";
  };
  mode.onchange();
  clear.onclick = () => {
    ticket++;
    set("", "");
    file.value = "";
    picker.value = "";
  };
  imp.onclick = () => file.click();
  file.onchange = async () => {
    const n = ++ticket;
    try {
      const f = file.files?.[0];
      if (!f) return;
      if (f.size > 1024 * 1024) throw Error("剧本不能超过1MB");
      const body = await f.text();
      if (active() && n === ticket) set(f.name, body);
    } catch (e) {
      error.textContent = e.message;
    }
  };
  choose.onclick = async () => {
    const n = ++ticket;
    try {
      const { assets } = await request("library");
      if (!active() || n !== ticket) return;
      picker.replaceChildren(element("option", "请选择剧本"));
      picker.firstChild.value = "";
      for (const a of assets.filter((a) => a.category === "scripts")) {
        const o = element("option", a.originalName);
        o.value = a.id;
        picker.append(o);
      }
      picker.hidden = false;
    } catch (e) {
      error.textContent = e.message;
    }
  };
  picker.onchange = async () => {
    const n = ++ticket;
    try {
      if (!picker.value) return;
      const response = await fetch(
        "/api/meiji/library/" + encodeURIComponent(picker.value),
      );
      if (!response.ok) throw Error("剧本读取失败");
      const body = await response.text();
      if (active() && n === ticket)
        set(picker.selectedOptions[0].textContent, body);
    } catch (e) {
      error.textContent = e.message;
    }
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    error.textContent = "";
    if (mode.value === "script" && !text.trim()) {
      error.textContent = "请导入或选择剧本";
      return;
    }
    if (mode.value === "free" && !premise.value.trim()) {
      error.textContent = "请填写 AI 创作方向";
      return;
    }
    submit.disabled = true;
    try {
      await save({
        name: name.value.trim(),
        creation_mode: mode.value === "script" ? "剧本" : "自由创作",
        aspect_ratio: aspect.value,
        creative_direction: mode.value === "free" ? premise.value.trim() : "",
        ...(mode.value === "script" ? { script: { body: text } } : {}),
      });
      dialog.close();
    } catch (e) {
      error.textContent = e.message;
    } finally {
      submit.disabled = false;
    }
  };
  root.append(dialog);
  dialog.addEventListener(
    "close",
    () => {
      ticket++;
      dialog.remove();
    },
    { once: true },
  );
  showPanelDialog(dialog);
  return dialog;
}
export function detailsDialog(
  root,
  title,
  values,
  save,
  { episode = false } = {},
) {
  const dialog = element("dialog"),
    head = element("div", "", "modal-head"),
    close = element("button", "×", "cancel"),
    form = element("form", "", episode ? "episode" : "edit"),
    error = element("div", "", "error"),
    footer = element("footer", "", "footer"),
    cancel = element("button", "取消", "cancel"),
    submit = element("button", "保存", "primary"),
    inputs = {};
  close.type = cancel.type = "button";
  close.onclick = cancel.onclick = () => dialog.close();
  head.append(element("h2", title), close);
  for (const [key, value] of Object.entries(values)) {
    const label = element(
        "label",
        {
          name: "短剧标题",
          duration_seconds: "本集时长（秒）",
          episode_requirements: "本集要求（选填）",
          reference_episode_duration_seconds: "参考单集时长（秒）",
          plot: "本集剧情（剧本原文）",
        }[key] || key,
      ),
      input = element(
        key === "aspect_ratio"
          ? "select"
          : ["episode_requirements", "plot"].includes(key)
            ? "textarea"
            : "input",
      );
    input.name = key;
    input.setAttribute("aria-label", label.textContent);
    if (key === "aspect_ratio")
      for (const v of ["1344x768", "768x1344"]) {
        const o = element("option", v);
        o.value = v;
        input.append(o);
      }
    if (key === "duration_seconds" || key === "reference_episode_duration_seconds") {
      input.type = "number";
      input.min = 1;
      input.max = 86400;
      input.step = 1;
      input.required = true;
    }
    if (key === "name") {
      input.required = true;
      input.maxLength = 100;
    }
    input.value = value;
    form.append(label, input);
    inputs[key] = input;
  }
  error.setAttribute("role", "alert");
  submit.type = "submit";
  footer.append(cancel, submit);
  form.append(error, footer);
  dialog.append(head, form);
  form.onsubmit = async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      await save(
        Object.fromEntries(
          Object.entries(inputs).map(([k, input]) => [
            k,
            ["duration_seconds", "reference_episode_duration_seconds"].includes(k)
              ? Number(input.value)
              : input.value,
          ]),
        ),
      );
      dialog.close();
    } catch (e) {
      error.textContent = e.message;
    } finally {
      submit.disabled = false;
    }
  };
  root.append(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  showPanelDialog(dialog);
  return dialog;
}
