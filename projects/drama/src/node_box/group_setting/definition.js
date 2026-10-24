// 团队设定独立盒子的运行时输出契约。
export default {
  "kind": "text",
  "output": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "groups"
    ],
    "properties": {
      "groups": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string",
              "description": "团队稳定标识；已有团队保留原ID。",
              "minLength": 1
            },
            "name": {
              "type": "string",
              "description": "来源中的团队、组织或背景群体名称，不虚构组织。",
              "minLength": 1
            },
            "social_role": {
              "type": "string",
              "description": "团队身份、职责、社会位置与剧情作用。"
            },
            "era": {
              "type": "string",
              "description": "时代及世界观背景。"
            },
            "region": {
              "type": "string",
              "description": "地域、气候及文化环境。"
            },
            "appearance": {
              "type": "string",
              "description": "基本团队形象：年龄与体型分布、面部与发式仪容、共同特征及合理个体差异；不只描述衣服。",
              "minLength": 1
            },
            "demeanor": {
              "type": "string",
              "description": "稳定的群体气质、姿态与行为风格，不替代镜头中的即时表演。"
            },
            "visual_identity": {
              "type": "string",
              "description": "可识别的团队视觉标识、配色与等级区分；无统一标识时明确说明。"
            },
            "immutable_traits": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "来源明确锁定的团队特征。"
              }
            },
            "costumes": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "description": "团队内稳定的服装版本ID。",
                    "minLength": 1
                  },
                  "name": {
                    "type": "string",
                    "description": "按场合、等级或岗位区分的服装名称。",
                    "minLength": 1
                  },
                  "description": {
                    "type": "string",
                    "description": "完整共同服装设计：内外层、鞋履头饰、材质色彩、版型纹样、标识及新旧程度。",
                    "minLength": 1
                  },
                  "story_segment_ids": {
                    "type": "array",
                    "items": {
                      "type": "string",
                      "description": "适用故事段ID；空数组表示通用，不能据此新增换装剧情。"
                    }
                  }
                },
                "required": [
                  "id",
                  "name",
                  "description",
                  "story_segment_ids"
                ],
                "additionalProperties": false
              }
            }
          },
          "required": [
            "id",
            "name",
            "social_role",
            "era",
            "region",
            "appearance",
            "demeanor",
            "visual_identity",
            "immutable_traits",
            "costumes"
          ],
          "additionalProperties": false
        }
      }
    }
  }
}
