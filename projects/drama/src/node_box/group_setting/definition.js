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
              "description": "需要统一着装的实际出场团队或组织名称；普通群众不纳入，不虚构组织。",
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
              "description": "简短基本团队形象，只写有用的共同外观，不强制罗列年龄体型或岗位差异。",
              "minLength": 1
            },
            "demeanor": {
              "type": "string",
              "description": "简短团队状态或整体作风；临时受伤、倒地及表演由镜头表现。"
            },
            "visual_identity": {
              "type": "string",
              "description": "必要的统一配色或标识，无独立标识可为空，不虚构等级。"
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
                    "description": "必要的统一服装名称；默认一套，不机械按岗位或场合拆分。",
                    "minLength": 1
                  },
                  "description": {
                    "type": "string",
                    "description": "简短统一着装：可识别的款式、主要颜色和必要特征，不机械拆分版本。",
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
