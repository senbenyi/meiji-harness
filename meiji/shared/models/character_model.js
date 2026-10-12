// 项目角色资料及角色图片、服装和参考图模型。
import { createId } from "../task_contract.js";
import { emptyCharacterImageModel } from "./character_image_model.js";
import { emptyReferenceImageModel } from "./reference_image_model.js";
export const emptyCharacterModel = (fields = {}) => ({ id: createId("character"), number: "", name: "", nationality: "", identity: "", identity_traits: "", gender: "", era: "", age: "", height: "", body_type: "", facial_features: "", voice: "", required_appearance: false, default_costume_id: "", character_image: emptyCharacterImageModel(), costume_images: [], reference_image: emptyReferenceImageModel(), costumes: [], ...fields });
