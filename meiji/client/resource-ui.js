import { element } from "./panel-dom.js";
import { editor, fieldsForm } from "./content-forms.js";
import { backHeader } from "./project-ui.js";
export const blankCharacter = () => ({
  编号: "C01",
  名称: "",
  国籍: "",
  身份: "",
  身份特征: "",
  性别: "",
  年代: "",
  年龄: "",
  身高: "",
  体型: "",
  面相: "",
  声音: "",
  必出: false,
  默认服装编号: "",
  服装: [],
});
export function addCharacter(root, env) {
  const chars = env.payload(env.p.角色库, env.p).角色;
  const value = blankCharacter();
  let i = 1;
  while (chars.some((c) => c.编号 === `C${String(i).padStart(2, "0")}`)) i++;
  value.编号 = `C${String(i).padStart(2, "0")}`;
  return editor(root, "添加角色", value, (c) =>
    env.act({
      type: "manual-edit",
      business_type: "project-characters",
      target_id: env.p.id,
      content: { 角色: [...chars, c] },
    }),
  );
}
export function renderResource(root, env) {
  const { p, state, go, button, act, nodeCard, busy, payload } = env,
    c = p.角色库.角色.find((c) => c.id === state.character_id);
  if (!c) return go("overview");
  const co = c.服装.find((co) => co.id === state.costume_id),
    view = element(
      "section",
      "",
      co ? "costume-detail" : "character-detail project-library-page",
    );
  backHeader(
    view,
    `${co?.名称 || c.名称} · ${co ? "服装" : "人物"}资料`,
    co ? "返回人物资料" : "返回项目概要",
    () => (co ? go("character", { costume_id: null }) : go("overview")),
  );
  const card = element("article", "", "overview-card");
  view.append(card);
  const image = nodeCard(
    co ? "costume-image" : "character-image",
    co?.id || c.id,
    co?.图片 || c.图片,
  );
  image.className = "character-primary-picture";
  card.append(image, element("p", co?.编号 || c.编号, "meta"));
  const raw = co
      ? { 名称: co.名称, 描述: co.描述 }
      : Object.fromEntries(
          Object.entries(payload(c, p)).filter(
            ([k]) => !["编号", "服装", "默认服装编号"].includes(k),
          ),
        ),
    form = element("form", "", "image-text-editor");
  form.dataset.draftKey = `resource:${co?.id || c.id}`;
  const fields = fieldsForm(raw, { disabled: busy });
  form.append(element("h4", "文字资料"), fields.box);
  const error = element("p", "", "error"),
    footer = element("footer", "", "image-text-footer"),
    save = element("button", "保存", "primary");
  save.type = "submit";
  save.disabled = busy;
  footer.append(save);
  form.append(error, footer);
  let defaultInput;
  if (co) {
    const label = element("label", "设为默认服装");
    defaultInput = element("input");
    defaultInput.type = "checkbox";
    defaultInput.checked = c.默认服装id === co.id;
    defaultInput.disabled = busy || defaultInput.checked;
    label.prepend(defaultInput);
    form.append(label);
  } else {
    const label = element("label", "默认服装"),
      select = element("select");
    select.name = "默认服装id";
    select.setAttribute("aria-label", "默认服装");
    const none = element("option", "不指定");
    none.value = "";
    select.append(none);
    for (const outfit of c.服装) {
      const o = element("option", `${outfit.编号} ${outfit.名称}`);
      o.value = outfit.id;
      select.append(o);
    }
    select.value = c.默认服装id;
    select.disabled = busy;
    label.append(select);
    form.append(label);
    defaultInput = select;
  }
  form.onsubmit = async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      const values = fields.read();
      if (!co) values.默认服装id = defaultInput.value;
      await act(
        {
          type: co ? "edit-costume" : "edit-character",
          target_id: co?.id || c.id,
          fields: values,
        },
        true,
      );
      if (co && defaultInput.checked && c.默认服装id !== co.id)
        await act(
          {
            type: "edit-character",
            target_id: c.id,
            fields: { 默认服装id: co.id },
          },
          true,
        );
      form.dataset.dirty = "false";
    } catch (e) {
      error.textContent = e.message;
    } finally {
      save.disabled = busy;
    }
  };
  form.oninput = () => (form.dataset.dirty = "true");
  card.append(form);
  card.append(
    button(co ? "删除服装" : "删除角色", async () => {
      if (!window.confirm(`删除${co?.名称 || c.名称}？`)) return;
      await act({
        type: "delete",
        business_type: co ? "costume-delete" : "character-delete",
        target_id: co?.id || c.id,
      });
      go(co ? "character" : "overview", { costume_id: null });
    }),
  );
  if (!co) {
    const upload = element("input");
    upload.type = "file";
    upload.hidden = true;
    upload.accept = "image/png,image/jpeg,image/webp";
    upload.disabled = busy;
    upload.setAttribute("aria-label", "上传角色参考图");
    upload.onchange = async () => {
      try {
        const file = upload.files?.[0];
        if (!file) return;
        const data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(Error("文件读取失败"));
          reader.readAsDataURL(file);
        });
        await act({ type: "reference-image", target_id: c.id, data }, true);
      } catch (e) {
        env.onError(e.message);
      }
    };
    card.append(
      upload,
      button("上传参考图", () => upload.click()),
    );
    if (c.参考图.地址) {
      const img = element("img");
      img.src = env.media(c.参考图.地址);
      img.alt = "角色参考图";
      img.style.maxWidth = "100%";
      card.append(img);
    }
    const wardrobe = element("section", "", "character-wardrobe"),
      head = element("div", "", "image-text-head");
    head.append(
      element("h4", "服装"),
      button("＋ 添加服装", () => {
        const chars = payload(p.角色库, p).角色,
          role = chars.find((r) => r.编号 === c.编号);
        let i = 1;
        while (
          role.服装.some(
            (co) => co.编号 === `${c.编号}-${String(i).padStart(2, "0")}`,
          )
        )
          i++;
        editor(
          root,
          "添加服装",
          {
            编号: `${c.编号}-${String(i).padStart(2, "0")}`,
            名称: "",
            描述: "",
          },
          (outfit) => {
            role.服装.push(outfit);
            return act({
              type: "manual-edit",
              business_type: "project-characters",
              target_id: p.id,
              content: { 角色: chars },
            });
          },
        );
      }),
    );
    const gallery = element("div", "", "wardrobe-images");
    wardrobe.append(head, gallery);
    for (const outfit of c.服装) {
      const item = element("article", "", "wardrobe-image");
      if (outfit.图片.地址) {
        const img = element("img");
        img.src = env.media(outfit.图片.地址);
        img.alt = outfit.名称;
        item.append(img);
      }
      const open = button(
        `${outfit.名称}${outfit.id === c.默认服装id ? " · 默认" : ""}`,
        () => go("character", { costume_id: outfit.id }),
        false,
      );
      open.className = "wardrobe-name";
      item.append(open);
      gallery.append(item);
    }
    card.append(wardrobe);
  }
  root.append(view);
}
