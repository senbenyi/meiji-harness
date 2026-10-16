// 角色资料；默认角色图直接读取第一套服装的定妆照，不保存第二份图片状态。
import { createId } from "../task_contract.js";
import { emptyCostumeImageModel } from "./costume_image_model.js";
import { emptyReferenceImageModel } from "./reference_image_model.js";
export const emptyCharacterModel = (fields = {}) => ({ id: createId("character"), name: "", age_range: "", nationality: "", gender: "", era: "", height: "", body_type: "", facial_features: "", voice: "", required_appearance: false, default_costume_id: "", costume_images: [emptyCostumeImageModel()], reference_image: emptyReferenceImageModel(), costumes: [], hairstyle: "", signature_props: [], position: "", immutable_traits: [], ...fields });
export const primaryCostumeImage = character => character.costume_images.find(image => image.costume_id === (character.costumes[0]?.id || "")) || emptyCostumeImageModel(character.costumes[0]?.id || "");
