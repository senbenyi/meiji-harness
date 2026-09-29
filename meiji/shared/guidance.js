// 指导素材分类（片库）与所属指导技能：素材是参考例子，指导技能是规则；生成时素材按指导技能分组编入提示词。
export const guidanceTypes = [['expression', '表情'], ['action', '动作'], ['martial', '武术'], ['effect', '特效'], ['sound', '声音'], ['dialogue', '对白'], ['music', '配乐'], ['other', '其他']]

// 素材分类 → 指导技能名（other 不属于任何指导，作为综合参考）。
export const assetGuidance = { action: 'action', effect: 'action', martial: 'martial', dialogue: 'dialogue', expression: 'expression', sound: 'sound', music: 'sound', other: '' }
