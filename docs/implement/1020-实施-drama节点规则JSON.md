# drama节点规则JSON实施记录

## 已修改文件
projects/drama/skills下8个节点JSON：script_revision、story_segments、character_extraction、costume_image、scene_extraction、scene_image、shot_design、video_prompt。

每个文件仅supports_supplement/rules，generate/review/revise各自仅base/supplement。业务规则和输出JSON示例、字段含义、数字类型说明都在动作base内。三种视频提示词模式分别说明；图片动作返回真实图片，不编造地址。三个程序节点无规则文件。

上一轮独立output字段与公共包支持已按用户最新要求撤回，公共RulesModel、相关测试、包说明和项目结构文档与HEAD一致。未改动并行工程配置或drama基础Model/manager。

## 验收与测试
AC-1～AC-4通过：8节点覆盖、24独立动作、纯规则Model结构、JSON往返与深拷贝通过。公共包原基线25项，扩展阶段28项，最终恢复25项全部通过，0失败、0取消。最终不再保存或编译JSON Schema对象；输出示例JSON解析通过。git diff --check通过。

最终日志：/tmp/drama-rules-validation.log、/tmp/drama-composer-final.log。

## 人工待办
后续接入项目创建导入与模型执行器；响应解析、业务校验和持久化仍由程序维护。本次无真实模型调用。
