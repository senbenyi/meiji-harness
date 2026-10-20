import { element } from "./panel-dom.js";

export function renderSettings(root, { busy = false, settings, saveSettings, back }) {
  const page = element("section", "", "settings-page"),
    backButton = element("button", "← 返回"),
    group = element("section", "", "settings-group"),
    language = element("select"),
    label = element("label", "生成语言", "settings-option"),
    message = element("p", "", "error settings-error");
  backButton.type = "button";
  backButton.onclick = back;
  message.setAttribute("role", "status");
  language.name = "output_language";
  language.setAttribute("aria-label", "生成语言");
  for (const [value, text] of [["zh-CN", "简体中文"], ["en", "English（英文）"]]) {
    const option = element("option", text);
    option.value = value;
    language.append(option);
  }
  language.value = settings?.output_language || "zh-CN";
  language.dataset.saved = language.value;
  language.disabled = busy || !settings;
  language.onchange = async () => {
    const previous = language.dataset.saved;
    language.disabled = true;
    message.textContent = "";
    try {
      await saveSettings?.({ output_language: language.value });
      language.dataset.saved = language.value;
    } catch (error) {
      language.value = previous;
      message.textContent = error.message;
    } finally { language.disabled = busy; }
  };
  label.append(language);
  group.append(element("h3", "语言"), label, message);
  page.append(backButton, element("h2", "设置"), group);
  root.append(page);
  return page;
}

export function renderModelSettings(root, { settings, modelOptions, busy = false, saveSettings, titles = {} }) {
  const group = element("section", "", "settings-group");
  group.append(element("h3", "模型"));
  const message = element("p", "", "error settings-error");
  message.setAttribute("role", "status");
  const selects = [];
  for (const [kind, title] of [["session", "会话模型"], ["text", "文本模型"], ["image", "图片模型"], ["video", "视频模型"]]) {
    const label = element("label", titles[kind] || title, "settings-option"), select = element("select");
    select.name = kind;
    select.setAttribute("aria-label", titles[kind] || title);
    for (const option of modelOptions[kind]) {
      const item = element("option", option.label);
      item.value = option.value;
      select.append(item);
    }
    select.value = settings[kind].model;
    select.disabled = busy;
    selects.push(select);
    select.onchange = async () => {
      const previous = settings[kind].model;
      selects.forEach(item => item.disabled = true);
      message.textContent = "";
      try {
        await saveSettings({ [kind]: { model: select.value } });
        settings[kind] = { model: select.value };
      } catch (error) {
        select.value = previous;
        message.textContent = error.message;
      } finally {
        selects.forEach(item => item.disabled = busy);
      }
    };
    label.append(select);
    group.append(label);
  }
  group.append(message);
  root.append(group);
}
