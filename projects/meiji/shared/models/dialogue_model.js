// 每秒分镜中的对白资料模型。未建卡人物和独立旁白的 speaker_id 为空，speaker_name 保留原称谓。
export const emptyDialogueModel = () => ({ speaker_id: "", speaker_name: "", mode: "画内", dialogue_text: "" });
