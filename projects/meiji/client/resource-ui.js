import { primaryCostumeImage } from "../shared/models/character_model.js";
import { element, showImagePreview } from "./panel-dom.js";
import { editor, fieldsForm } from "./content-forms.js";
import { backHeader } from "./project-ui.js";
import { emptyCostumeImageModel } from "../shared/models/costume_image_model.js";
export const blankCharacter = () => ({
  name: "", gender: "", era: "", position: "", age_range: "", body_type: "", hairstyle: "",
  signature_props: [], immutable_traits: [], costumes: [],
});
export function addCharacter(root, env) {
  return editor(root, "添加角色", blankCharacter(), (character) =>
    env.act({ type: "manual-edit", business_type: "project-characters",
      target_id: env.p.basic_info.id, content: { characters: [character] } }),
  );
}
export function renderResource(root, env) {
  const { p, state, go, button, act, nodeCard, busy, media } = env;
  const character = p.character_library.characters.find((c) => c.id === state.character_id);
  if (!character) return go("overview");
  const costumeView = state.costume_id !== null && state.costume_id !== undefined;
  const costume = character.costumes.find((c) => c.id === state.costume_id);
  if (costumeView && state.costume_id && !costume) return go("character", { costume_id: null });
  const costumeId = costume?.id || "";
  const image = costumeView
    ? character.costume_images.find((entry) => entry.costume_id === costumeId) || emptyCostumeImageModel(costumeId)
    : primaryCostumeImage(character);
  const historical = costumeView && !costume && character.costumes.length > 0;
  const title = costumeView ? `${character.name} · ${costume?.name || "未绑定服装定妆照"}` : `${character.name} · 人物资料`;
  const view = element("section", "", costumeView ? "costume-detail" : "character-detail project-library-page");
  backHeader(view, title, costumeView ? "返回人物资料" : "返回项目概要",
    () => costumeView ? go("character", { costume_id: null }) : go("overview"));
  const card = element("article", "", "overview-card");
  if (costumeView) {
    const imageCard = nodeCard("costume-image", costume?.id || character.id, image, { readOnly: historical });
    imageCard.className = "character-primary-picture";
    card.append(imageCard);
    if (historical) card.append(element("p", "此图为尚无明确服装时的历史定妆照，内容与任务历史保留。", "meta"));
  }
  card.append(element("p", costume?.id || character.id, "meta"));
  if (!costumeView || costume) {
    const keys = costume ? ["name", "color", "material", "props"]
      : ["name", "position", "age_range", "body_type", "hairstyle", "signature_props", "immutable_traits", "gender", "nationality", "era", "height", "facial_features", "voice", "required_appearance"];
    const target = costume || character;
    const fields = fieldsForm(Object.fromEntries(keys.map((key) => [key, target[key]])), { disabled: busy });
    const form = element("form", "", "image-text-editor");
    form.dataset.draftKey = `resource:${target.id}`;
    form.append(element("h4", "文字资料"), fields.box);
    if (!costume) {
      const label = element("label", "默认服装"), select = element("select");
      select.name = "default_costume_id";
      select.setAttribute("aria-label", "默认服装");
      const none = element("option", "不指定"); none.value = ""; select.append(none);
      for (const outfit of character.costumes) {
        const option = element("option", outfit.name);
        option.value = outfit.id; select.append(option);
      }
      select.value = character.default_costume_id; select.disabled = busy;
      label.append(select); form.append(label);
    }
    const error = element("p", "", "error"), save = element("button", "保存", "primary"), footer = element("div", "", "form-save-footer");
    save.type = "submit"; save.disabled = busy;
    footer.append(save);
    form.append(error, footer);
    form.oninput = () => { form.dataset.dirty = "true"; };
    form.onsubmit = async (event) => {
      event.preventDefault(); save.disabled = true;
      try {
        const select = form.querySelector("[name=default_costume_id]");
        await act({ type: costume ? "edit-costume" : "edit-character", target_id: target.id,
          fields: { ...fields.read(), ...(!costume && select ? { default_costume_id: select.value } : {}) } }, true);
        form.dataset.dirty = "false";
      } catch (cause) { error.textContent = cause.message; }
      finally { save.disabled = busy; }
    };
    card.append(form);
    const remove = button(costume ? "删除服装" : "删除角色", async () => {
      if (!window.confirm(`删除${target.name}？`)) return;
      await act({ type: "delete", business_type: costume ? "costume-delete" : "character-delete", target_id: target.id });
      go(costume ? "character" : "overview", { costume_id: null });
    });
    remove.classList.add("delete-content");
    if (costume) {
      const actions = element("div", "", "workflow-generation-row character-detail-actions");
      actions.append(remove);
      card.append(actions);
    } else card._remove = remove;
  }
  if (!costumeView) {
    const portraits = character.costumes.length ? character.costumes.map((outfit) => character.costume_images.find((entry) => entry.costume_id === outfit.id)) : [primaryCostumeImage(character)];
    const regenerate = portraits.every((portrait) => portrait?.address);
    const actions = element("div", "", "workflow-generation-row character-detail-actions");
    actions.append(button(regenerate ? "重新生成定妆照" : "生成定妆照", () => act({ type: "submit-costumes", target_id: character.id, action: regenerate ? "regenerate" : "generate" })));
    const upload = element("input"); upload.type = "file"; upload.hidden = true;
    upload.accept = "image/png,image/jpeg,image/webp"; upload.disabled = busy;
    upload.setAttribute("aria-label", "上传角色参考图");
    upload.onchange = async () => {
      try {
        const file = upload.files?.[0]; if (!file) return;
        const data = await new Promise((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(Error("文件读取失败")); reader.readAsDataURL(file);
        });
        await act({ type: "reference-image", target_id: character.id, data }, true);
      } catch (cause) { env.onError(cause.message); }
    };
    actions.append(upload, button("上传参考图", () => upload.click()), card._remove);
    delete card._remove;
    const meta = [...card.children].find((node) => node.matches("p.meta"));
    card.prepend(actions);
    if (meta) card.insertBefore(meta, actions);
    if (character.reference_image.address) {
      const preview = element("figure", "", "reference-preview");
      const img = element("img"); img.src = media(character.reference_image.address);
      img.alt = "角色参考图"; preview.append(img); card.insertBefore(preview, card.querySelector("form"));
    }
    const wardrobe = element("section", "", "character-wardrobe"), head = element("div", "", "image-text-head");
    head.append(element("h4", "定妆照"));
    const clothes = element("section", "", "image-text-wide character-costumes");
    const clothesHead = element("div", "", "image-text-head");
    clothesHead.append(element("h4", "服装"), button("＋ 添加服装", () =>
      editor(root, "添加服装", { name: "", color: "", material: "", props: [] }, (outfit) =>
        act({ type: "manual-edit", business_type: "project-characters", target_id: p.basic_info.id,
          content: { characters: [{ ...Object.fromEntries(Object.keys(blankCharacter()).filter((key) => key !== "costumes").map((key) => [key, character[key]])), costumes: [outfit] }] } }),
      ),
    ));
    clothes.append(clothesHead);
    for (const outfit of character.costumes) {
      const row = element("fieldset", "", "overview-card");
      row.append(button(outfit.name, () => go("character", { costume_id: outfit.id }), false));
      const identity = element("p", `ID：${outfit.id}`, "meta costume-id");
      identity.style.overflowWrap = "anywhere";
      row.append(identity);
      for (const [label, value] of [["颜色", outfit.color], ["材质", outfit.material], ["道具", outfit.props.join("、")]])
        row.append(element("p", `${label}：${value || "未明确"}`, "meta"));
      clothes.append(row);
    }
    const form = card.querySelector(".image-text-editor");
    form.querySelector(".image-text-grid").append(clothes);
    const gallery = element("div", "", "wardrobe-images"); wardrobe.append(head, gallery);
    const entries = character.costumes.map((outfit) => ({ outfit, image: character.costume_images.find((entry) => entry.costume_id === outfit.id) }));
    const unbound = character.costume_images.find((entry) => entry.costume_id === "");
    if (!character.costumes.length || unbound) entries.push({ outfit: null, image: unbound });
    for (const entry of entries) {
      const item = element("article", "", "wardrobe-image");
      const label = entry.outfit?.name || (character.costumes.length ? "未绑定服装定妆照（历史）" : "未绑定服装定妆照");
      if (entry.image?.address) {
        const img = element("img"), preview = element("button", "", "costume-picture-preview");
        img.src = media(entry.image.address); img.alt = label;
        preview.type = "button";
        preview.style.cursor = "zoom-in";
        preview.setAttribute("aria-label", `放大查看${label}`);
        preview.onclick = () => showImagePreview(root, img);
        preview.append(img); item.append(preview);
      }
      const open = button(label, () => go("character", { costume_id: entry.outfit?.id || "" }), false);
      open.className = "wardrobe-name"; item.append(open);
      gallery.append(item);
    }
    card.append(wardrobe);
  }
  view.append(card); root.append(view);
}
