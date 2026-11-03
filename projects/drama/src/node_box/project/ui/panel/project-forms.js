const PROJECT_ASPECT_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
import { element, showPanelDialog } from "../../../../client/ui/panel-dom.js";
export function projectDialog(root, save, { listScripts, readScript, maxScriptBytes=1024*1024, project=null } = {}) {
  const editing = !!project, info = project?.basic_info;
  const existingScript = project?.source?.revisions.find(row => row.id === project.source.current_revision_id);
  const dialog = element("dialog");
  dialog.id = editing ? "edit-project" : "create-project";
  dialog.setAttribute("aria-labelledby", editing ? "edit-title" : "create-title");
  const head = element("div", "", "modal-head"),
    title = element("h2", editing ? "编辑短剧" : "创建短剧");
  title.id = editing ? "edit-title" : "create-title";
  const close = element("button", "×", "cancel");
  close.setAttribute("aria-label", editing ? "关闭编辑弹窗" : "关闭创建弹窗");
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
  const mode = field("创作模式", editing ? "edit-project-mode" : "project-mode", element("select"));
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
    imp = element("button", "本地导入", "script-import"),
    choose = element("button", "素材库导入", "script-choose"),
    clear = element("button", editing ? "撤销替换" : "移除剧本", "script-clear"),
    file = element("input"),
    picker = element("select", "", "script-picker"),
    selected = element("div", "", "meta script-selected");
  file.type = "file";
  file.accept = ".txt,.text,.md";
  file.hidden = true;
  file.setAttribute("aria-label", "导入剧本文件");
  picker.id = editing ? "edit-project-script" : "project-script";
  picker.setAttribute("aria-label", "选择剧本");
  picker.hidden = clear.hidden = true;
  for (const b of [imp, choose, clear]) b.type = "button";
  choose.hidden = !listScripts || !readScript;
  row.append(imp, choose, clear);
  scriptGroup.append(element("label", "剧本"), row, file, picker, selected);
  form.append(scriptGroup);
  const name = field("短剧标题", editing ? "edit-project-title" : "title", element("input"));
  name.name = "title";
  name.required = true;
  name.maxLength = 100;
  name.placeholder = "给这个故事起个名字";
  name.autofocus = true;
  name.value = info?.name || "";
  const aspect = field("画幅", editing ? "edit-project-aspect" : "aspect", element("select"));
  aspect.name = "aspect";
  for (const v of PROJECT_ASPECT_RATIOS) {
    const o = element("option", v);
    o.value = v;
    aspect.append(o);
  }
  aspect.value = info?.aspect_ratio || "9:16";
  const error = element("div", "", "error");
  error.setAttribute("role", "alert");
  const footer = element("footer", "", "footer"),
    cancel = element("button", "取消", "cancel"),
    submit = element("button", editing ? "保存" : "创建短剧", "primary");
  cancel.type = "button";
  submit.type = "submit";
  cancel.onclick = () => dialog.close();
  footer.append(cancel, submit);
  form.append(error, footer);
  dialog.append(
    head,
    element(
      "p",
      editing ? "修改短剧信息；需要更换剧本时重新导入，保存后保留原稿历史。" : "选择创作模式，填写标题和画幅；剧本模式需要导入剧本。",
    ),
    form,
  );
  let filename = existingScript?.original_name || '', text = "", ticket = 0, keptExisting = !!existingScript, scriptChanged = false;
  mode.value = info?.creation_mode === '自由创作' ? 'free' : 'script';
  if (editing) selected.textContent = filename || '尚未导入剧本';
  const active = () => dialog.isConnected;
  const set = (providedName, body) => {
    if (typeof body !== 'string' || providedName && !body.trim()) throw Error('剧本不能为空');
    if (new Blob([body]).size > maxScriptBytes) throw Error(`剧本不能超过${maxScriptBytes/1024/1024}MB`);
    keptExisting = false; scriptChanged = true;
    filename = providedName;
    text = body;
    selected.textContent = filename;
    clear.hidden = !body;
    if (!name.value) name.value = filename.replace(/\.(txt|text|md)$/i, "");
  };
  mode.onchange = () => {
    scriptGroup.hidden = mode.value !== "script";
  };
  mode.onchange();
  clear.onclick = () => {
    ticket++;
    if (editing) {
      filename = existingScript?.original_name || ''; text = ''; keptExisting = !!existingScript; scriptChanged = false;
      selected.textContent = filename || '尚未导入剧本'; clear.hidden = true;
    } else set("", "");
    file.value = "";
    picker.value = "";
  };
  imp.onclick = () => file.click();
  file.onchange = async () => {
    const n = ++ticket;
    try {
      const f = file.files?.[0];
      if (!f) return;
      if (!/\.(txt|text|md)$/i.test(f.name)) throw Error("请选择TXT或Markdown剧本");
      if (f.size > maxScriptBytes) throw Error(`剧本不能超过${maxScriptBytes/1024/1024}MB`);
      const body = await f.text();
      if (active() && n === ticket) set(f.name, body);
    } catch (e) {
      error.textContent = e.message;
    }
  };
  choose.onclick = async () => {
    const n = ++ticket;
    try {
      const assets = await listScripts();
      if (!active() || n !== ticket) return;
      picker.replaceChildren(element("option", "请选择剧本"));
      picker.firstChild.value = "";
      for (const a of assets.filter((a) => a.category === "scripts")) {
        const o = element("option", a.originalName);
        o.value = a.id;
        picker.append(o);
      }
      picker.hidden = false;
      error.textContent = assets.some(a => a.category === "scripts") ? "" : "素材库暂无剧本，请先在片库的素材 / 剧本中导入";
    } catch (e) {
      error.textContent = e.message;
    }
  };
  picker.onchange = async () => {
    const n = ++ticket;
    try {
      if (!picker.value) return;
      const body = await readScript(picker.value);
      if (active() && n === ticket)
        set(picker.selectedOptions[0].textContent, body);
    } catch (e) {
      error.textContent = e.message;
    }
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    error.textContent = "";
    if (mode.value === "script" && !text.trim() && !keptExisting && (!editing || info.creation_mode !== "剧本" || scriptChanged)) {
      error.textContent = "请导入或选择剧本";
      return;
    }
    submit.disabled = true;
    try {
      const basic_info = {name: name.value.trim(), creation_mode: mode.value === 'script' ? '剧本' : '自由创作', aspect_ratio: aspect.value};
      await save(editing ? {basic_info, ...(mode.value === 'script' && scriptChanged && text.trim() ? {source:{text, original_name:filename}} : {})}
        : {basic_info:{...basic_info, original_script_filename:mode.value === 'script' ? filename : '', original_script:mode.value === 'script' ? text : ''}});
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
  dialog.setAttribute("aria-label", title);
  close.type = cancel.type = "button";
  close.onclick = cancel.onclick = () => dialog.close();
  head.append(element("h2", title), close);
  for (const [key, value] of Object.entries(values)) {
    const label = element(
        "label",
        {
          name: "短剧标题",
          aspect_ratio: "画幅",
          creation_mode: "创作模式",
          output_language: "内容语言",
          duration_seconds: "本集时长（秒）",
          episode_requirements: "本集要求（选填）",
          reference_episode_duration_seconds: "参考单集时长（秒）",
          plot: "本集规划（核心事件与前后集衔接）",
        }[key] || key,
      ),
      input = element(
        ["aspect_ratio", "creation_mode", "output_language"].includes(key)
          ? "select"
          : ["episode_requirements", "plot"].includes(key)
            ? "textarea"
            : "input",
      );
    input.name = key;
    input.setAttribute("aria-label", label.textContent);
    const choices = key === "aspect_ratio" ? PROJECT_ASPECT_RATIOS.map(v => [v, v])
      : key === "creation_mode" ? [["剧本", "剧本模式"], ["自由创作", "自由模式"]]
      : key === "output_language" ? [["zh-CN", "简体中文"], ["en", "English（英文）"], ["zh-TW", "繁体中文"], ["ja", "日语"]] : null;
    if (choices) {
      if (key === "output_language" && !choices.some(([v]) => v === value)) choices.push([value, value]);
      for (const [v, label] of choices) {
        const option = element("option", label);
        option.value = v;
        input.append(option);
      }
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
