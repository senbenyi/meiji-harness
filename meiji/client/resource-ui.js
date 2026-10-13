import { element } from "./panel-dom.js";
import { editor, fieldsForm } from "./content-forms.js";
import { backHeader } from "./project-ui.js";
import { emptyCostumeImageModel } from "../shared/models/costume_image_model.js";
export const blankCharacter = () => ({
  name: "", position: "", age_range: "", body_type: "", hairstyle: "",
  signature_props: "", immutable_traits: "", costumes: [],
});
export function addCharacter(root, env) {
  return editor(root, "添加角色", blankCharacter(), (character) =>
    env.act({ type: "manual-edit", business_type: "project-characters",
      target_id: env.p.id, content: { characters: [character] } }),
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
    : character.character_image;
  const historical = costumeView && !costume && character.costumes.length > 0;
  const title = costumeView ? `${character.name} · ${costume?.name || "未绑定服装定妆照"}` : `${character.name} · 人物资料`;
  const view = element("section", "", costumeView ? "costume-detail" : "character-detail project-library-page");
  backHeader(view, title, costumeView ? "返回人物资料" : "返回项目概要",
    () => costumeView ? go("character", { costume_id: null }) : go("overview"));
  const card = element("article", "", "overview-card");
  const imageCard = nodeCard(costumeView ? "costume-image" : "character-image",
    costume?.id || character.id, image, { readOnly: historical });
  imageCard.className = "character-primary-picture";
  card.append(imageCard, element("p", costume?.number || character.number, "meta"));
  if (historical) card.append(element("p", "此图为尚无明确服装时的历史定妆照，内容与任务历史保留。", "meta"));
  if (!costumeView || costume) {
    const keys = costume ? ["name", "color", "material", "props"]
      : ["name", "position", "age_range", "body_type", "hairstyle", "signature_props", "immutable_traits", "gender", "nationality", "era", "height", "facial_features", "voice", "required_appearance"];
    const target = costume || character;
    const fields = fieldsForm(Object.fromEntries(keys.map((key) => [key, target[key]])), { disabled: busy });
    const form = element("form", "", "image-text-editor");
    form.dataset.draftKey = `resource:${target.id}`;
    form.append(element("h4", "文字资料"), fields.box);
    const label = element("label", "默认服装"), select = element("select");
    select.name = "default_costume_id";
    select.setAttribute("aria-label", "默认服装");
    const none = element("option", "不指定"); none.value = ""; select.append(none);
    for (const outfit of character.costumes) {
      const option = element("option", `${outfit.number} ${outfit.name}`);
      option.value = outfit.id; select.append(option);
    }
    select.value = character.default_costume_id; select.disabled = busy;
    label.append(select); form.append(label);
    const error = element("p", "", "error"), save = element("button", "保存", "primary");
    save.type = "submit"; save.disabled = busy;
    form.append(error, save);
    form.oninput = () => { form.dataset.dirty = "true"; };
    form.onsubmit = async (event) => {
      event.preventDefault(); save.disabled = true;
      try {
        await act({ type: costume ? "edit-costume" : "edit-character", target_id: target.id,
          fields: { ...fields.read(), ...(!costume ? { default_costume_id: select.value } : {}) } }, true);
        if (costume && select.value !== character.default_costume_id)
          await act({ type: "edit-character", target_id: character.id, fields: { default_costume_id: select.value } }, true);
        form.dataset.dirty = "false";
      } catch (cause) { error.textContent = cause.message; }
      finally { save.disabled = busy; }
    };
    card.append(form, button(costume ? "删除服装" : "删除角色", async () => {
      if (!window.confirm(`删除${target.name}？`)) return;
      await act({ type: "delete", business_type: costume ? "costume-delete" : "character-delete", target_id: target.id });
      go(costume ? "character" : "overview", { costume_id: null });
    }));
  }
  if (!costumeView) {
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
    card.append(upload, button("上传参考图", () => upload.click()));
    if (character.reference_image.address) {
      const img = element("img"); img.src = media(character.reference_image.address);
      img.alt = "角色参考图"; img.style.maxWidth = "100%"; card.append(img);
    }
    const wardrobe = element("section", "", "character-wardrobe"), head = element("div", "", "image-text-head");
    head.append(element("h4", "定妆照与服装"), button("＋ 添加服装", () =>
      editor(root, "添加服装", { name: "", color: "", material: "", props: "" }, (outfit) =>
        act({ type: "manual-edit", business_type: "project-characters", target_id: p.id,
          content: { characters: [{ ...Object.fromEntries(Object.keys(blankCharacter()).filter((key) => key !== "costumes").map((key) => [key, character[key]])), costumes: [outfit] }] } }),
      ),
    ));
    const gallery = element("div", "", "wardrobe-images"); wardrobe.append(head, gallery);
    const entries = character.costumes.map((outfit) => ({ outfit, image: character.costume_images.find((entry) => entry.costume_id === outfit.id) }));
    const unbound = character.costume_images.find((entry) => entry.costume_id === "");
    if (!character.costumes.length || unbound) entries.push({ outfit: null, image: unbound });
    for (const entry of entries) {
      const item = element("article", "", "wardrobe-image");
      const label = entry.outfit?.name || (character.costumes.length ? "未绑定服装定妆照（历史）" : "未绑定服装定妆照");
      if (entry.image?.address) { const img = element("img"); img.src = media(entry.image.address); img.alt = label; item.append(img); }
      const open = button(label, () => go("character", { costume_id: entry.outfit?.id || "" }), false);
      open.className = "wardrobe-name"; item.append(open);
      gallery.append(item);
    }
    card.append(wardrobe);
  }
  view.append(card); root.append(view);
}
