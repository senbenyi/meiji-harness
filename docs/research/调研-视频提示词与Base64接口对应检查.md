# 视频提示词与 Base64 接口对应检查

## 结论
- AC-1 已确认：当前新分镜只选择 text/reference，按 referenceSnapshot 固定 Picture 编号及顺序。
- AC-2 已确认：读取本地素材/尾帧后按原顺序编码 data:image/...;base64,...；视频网关发送 reference_images，prompt 原样传递。
- AC-3 部分不一致：强制首帧旧分支仍在预览与模式选择中，但实际 prepareFilmOpening 恒返回空对象；真实操作无法为 first_frame 提供 inputReference。预览与日志 model 固定 elysium-video，实际发送配置的 video.model。
- AC-4 未确认：当前 ~/.dsh 项目中可检查的已保存最终分镜为 0；没有对真实网关发送收费请求，不能宣称线上已生成视频验证。

## 规格
- 目标：检查最终视频提示词、素材编号、Base64 数组与仓库网关契约一致性。
- 非目标：修改业务代码、重新生成用户数据、付费视频生成。
- 验收：AC-1 编号顺序一致；AC-2 编码与字段一致；AC-3 预览/实际模式参数一致；AC-4 说明实际数据及线上验证范围。

## 调用链
每秒指令 → generateShotStoryboard → 固定素材清单/Picture 编号 → referenceSnapshot → filmSubmit → referenceImageData → submitFilm → submitH3 → submitGatewayVideo → POST /v1/videos。

## 证据
| 来源 | 结论 |
|---|---|
| meiji/server/generate/shot-text.js:149 | 人物/场景等先加入，已有上一镜尾帧最后加入，超过 9 张拒绝，快照与提示词引用共用 images |
| meiji/shared/reference-images.js:3 | 存在快照时按快照顺序返回，不重新排列 |
| meiji/server/data/pictures.js:50 | 顺序读取、顺序 push data URL，缺文件报错不跳过 |
| meiji/server/flow/operations/films.js:191 | 单镜与整集提交均把同序 media 传给 submitFilm |
| meiji/server/generate/gateway.js:256 | JSON 字段与 docs/gateway-api.md 第7节对应；参考模式不混入 input_reference |
| meiji/server/generate/film.js:7 | 校验结构、Picture 数量/边界、Subject 定义和引用；不能仅靠此结构检查保证 AI 对人物身份的语义绑定一定正确 |
| meiji/server/flow/operations/films.js:25 | prepareFilmOpening 无首帧读取；previewFilmSubmit 使用占位 frame 且固定模型名 |

## 验证
- production、gateway、storyboard 相关测试：41 通过，0 失败/取消。
- continuity-reference：5 通过，0 失败/取消。
- 临时集成验证：真实分镜组装 → 人物及场景素材读取 → Base64 → 最终 JSON，拦截 fetch、不访问网络。Picture 1/2 解码字节与各自输入完全相同，prompt 未改变，请求字段为 model/prompt/seconds/size/reference_images。
- 该验证使用可区分的模拟图片字节，仅验证映射和编码传输，不证明真实网关图片解码或模型画面质量。

## 问题
| AC | 预期 | 实际 | 根因 |
|---|---|---|---|
| AC-3 | 首帧预览与真实提交一致 | 预览可显示 first_frame，实际缺少首帧而拒绝 | 新设计将尾帧纳入参考快照，但旧模式分支仍保留 |
| AC-3 | 展示模型等于实际模型 | 预览/日志固定 elysium-video | 展示没有使用实际 video.model 配置 |

## 待用户决定
无；本轮检查未修改业务代码。新参考图主流程可对应，旧首帧残留与展示模型问题应单独修复。
