# 各接口独立定义提示词

各生成接口的请求结构在 `server/prompts/interfaces/` 独立维护。公共层不再决定角色、顺序、语言段落或 JSON 模式；网关仍共用网络请求、鉴权、取消和日志。

## 修改入口

以下路径均相对于 `meiji/server/prompts/interfaces/`：

| 接口 | 文件 |
|---|---|
| 剧集摘要 | `episode.js` |
| 剧情整包、人物卡与场景卡的文字生成/修订 | `outline.js`（调用方传入各自的任务上下文） |
| 镜头表 | `shots.js` |
| 单镜修订 | `shot-revise.js` |
| 每秒指令（整集与单镜） | `seconds.js` |
| 文本分镜 | `storyboard.js` |
| 图片提示词改写 | `image-prompt.js` |
| 人物图 | `character-image.js` |
| 场景图 | `scene-image.js` |
| 附属素材图 | `part-image.js` |
| 铅笔分镜图 | `pencil.js` |
| 最终视频提交 | `video.js` |

`registry.js` 只分发已注册的接口，不为未知接口套默认模板。七个文本模块分别提供 `generate`、`review`、`revise`；人工意见修改使用本接口 `generate` 的 modify 分支。

## 文本结构

文本接口返回 `{ system: 分段数组, user: 分段数组, json: 布尔值 }`。例如在单个接口中自行调整：

```js
return {
  json: false,
  system: [p.generate, p.protocol],
  user: [p.context, p.opinion, p.language],
}
```

这个接口将任务语言放在 user 中，且不选其他片段；不会影响其他接口。也可以使用 `segment('context', '自定义标题', 自定义文本)`，标题传空字符串则不加标题。`system: []` 表示只发 user；修改输出格式仍需满足本阶段的解析和审核协议。

`generationParts`、`reviewParts` 是可选的片段工具，不强制任何最终顺序。接口显式选用它们，可以继续使用任务固定的技能版本、页面基础覆盖、本剧补充、指导与素材；不应改成直接读取内置 Markdown 而绕过这些层。`text-context.js` 的本次要求与修订上下文也由接口显式选择使用。

## 图片和视频

图片接口返回 prompt 分段数组。例如人物图的默认结构在 `character-image.js`：

```js
return [p.requirement, p.addition, p.language, p.style, p.request]
```

可以单独移动、改标题或替换片段。`p.requirement` 包含人物图调用方提供的适龄着装约束，不要在调整结构时丢失。构图和画面要求正文仍在 `skills/stages/character-image/generate.md`。

视频的最终正文、成片技能补充、人工意见和上一镜尾帧衔接都在 `video.js` 组装；流程层负责参考图和模式参数。网络层按接口产出的 prompt 发送。

## 预览与生效

技能详情页预览调用同一组接口模块。图片与视频预览缺少具体生成对象时使用清楚标明的上下文占位符，预览不是某次完整实际请求；实际发送内容仍以 API 日志为准。

这次迁移保留了原有提示词内容，28 个文本/图片场景快照逐项一致；视频只规范了段落间空行。结构已独立，后续只需编辑目标接口模块。

修改 JavaScript 后需重启 Harness；这次没有实现文件热更新：

```bash
bash /Users/devin/meiji/llm-dsh-plugins/restart-harness.sh
```

验证：`cd meiji && npm test`，并使用 `tests/fixtures/prompt-scenarios.js` 与 `scripts/prompt-diff.js` 对照改动前后提示词，核对预览与真实发送保持一致。
