# drama 节点规则

每种AI节点一个JSON，共8个。文件内容就是项目对应节点 `rules` 的初始值，可直接深拷贝导入。

| 文件 | 导入位置 |
|---|---|
| [script_revision.json](script_revision.json) | `script_revision.rules` |
| [story_segments.json](story_segments.json) | `story_segments.rules` |
| [character_extraction.json](character_extraction.json) | `character_extraction.rules` |
| [costume_image.json](costume_image.json) | `character_extraction.characters[].costume_images[].rules` |
| [scene_extraction.json](scene_extraction.json) | `scene_extraction.rules` |
| [scene_image.json](scene_image.json) | `scene_extraction.scenes[].image_generation.rules` |
| [shot_design.json](shot_design.json) | `shot_design.rules` |
| [video_prompt.json](video_prompt.json) | `video_prompt.rules` |

分片编排、调用视频接口的视频生成和合片都是程序节点，不提供规则JSON。

每份JSON只包含 `supports_supplement` 和 `rules`；后者包含 `generate/review/revise`，每个动作独立保存 `base` 规则文本、初始为空的 `supplement` 和 `output` 输出定义。各实例分别深拷贝，不共享可变对象。

规则只描述业务内容与质量要求。输出JSON的字段清单、嵌套结构、类型、必填及枚举独立放入各动作的 `output.schema`，字段解释放在Schema对应字段的 `description`；不混进 `base/supplement`。`output.type` 为 `json` 或 `image`；图片生成及修订接收真实图片接口结果，审核返回JSON。接口素材编码和原值绑定仍由执行器维护。字段以 [project_detail.json](../docs/project_detail.json) 为依据，运行时接入时由执行器读取输出定义并校验响应。视频提示词只要求模型返回prompt内容，素材和请求参数由程序绑定。meiji的旧定义在 `shared/prompt-models` 之外的 `server/http/nodes`，其旧字段不能直接套用于drama。

初始化后遵循 [开发方向](../docs/开发方向.md)：以项目保存的规则为准，本目录更新不覆盖已有项目；修改规则须人工授权。调用公共 `RulesModel.resolve` 时，显式传入项目保存的该动作 `base`。

当前已提供默认规则文件，尚未接入项目创建与模型调用。
