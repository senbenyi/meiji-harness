# 提示词编排

纯 ESM、零外部依赖。不选择模型、不发送 HTTP、不保存数据，也不内置任何业务规则。

```js
import { fillTemplate, renderSections, composeMessages } from '@agent-modules/prompt-composer';

const input = fillTemplate({ system: { 规则: '{{rules}}' }, user: { 任务: '整理资料', 来源: '{{source}}' } }, {
  rules: '只使用所提供资料。', source: { title: '示例资料', text: '...' },
});
const { messages } = composeMessages({
  system: renderSections(input.system),
  user: renderSections(input.user),
  role: 'system',
});
```

## 接口

- `fillTemplate(template, values, { literalKeys, fail })`：递归展开模板。完整 `{{key}}` 可以承载对象或数组，文本中的占位符只接受非对象值。资料只注入一次，其中的 `{{...}}` 保留原文；缺少资料直接失败。`literalKeys` 指定不解释的字面量字段，例如输出结构示例。默认错误码为 `INVALID_TEMPLATE`，可通过 `fail(path, message)` 接入宿主错误协议；该回调须抛出异常。
- `renderSections(value, { jsonKeys, level })`：将对象按层级渲染为 Markdown 章节，数组按 JSON 展示。`jsonKeys` 指定保持完整 JSON 的对象章节。空章节省略，JSON 章节内部的空值与布尔值保留。
- `composeMessages({ system, user, role, history })`：返回 `{ messages, system, user, body }`。消息顺序为固定约束、调用方给出的历史、最新 user。默认角色 `system`，可传 `developer`。历史深拷贝，不增加额外提示词。

修订时，调用方可在 `history` 传入原始 user 和 assistant 基稿，在 `user` 放本轮意见；审核、生成及修订的业务语义、规则合并顺序和输出契约均由调用方定义。模板对象里的空字符串/null 字段会省略；由完整占位符注入的对象按原样保留，不再次遍历清理。

## 规则模型

`RulesModel` 定义规则数据的公共结构。外层 `supports_supplement` 表示是否支持补充规则，默认 `false`；`rules` 保留三个动作各自的规则：

```json
{
  "supports_supplement": true,
  "rules": {
    "generate": { "base": "生成基础规则快照", "supplement": "生成补充规则" },
    "review": { "base": "审核基础规则快照", "supplement": "审核补充规则" },
    "revise": { "base": "修订基础规则快照", "supplement": "修订补充规则" }
  }
}
```

```js
import { RulesModel, fillTemplate, renderSections } from '@agent-modules/prompt-composer';

const model = new RulesModel({
  supports_supplement: true,
  rules: { generate: { base: '保存时的快照', supplement: '仅使用提供的资料' } },
});
// 当前基础规则由业务代码提供；执行、展示、依赖计算统一使用 resolve 的结果。
const currentRules = model.resolve('generate', '当前代码中的生成规则');
const prompt = renderSections(fillTemplate({ 规则: '{{rules}}' }, { rules: currentRules }));
const savedData = model.toJSON(); // 由项目自行持久化，与 UI 同步。
```

- `new RulesModel(data = {})`：缺省动作和文本补齐为空字符串。字段名、文本类型及布尔值严格校验，非法输入抛出带 `code: 'INVALID_RULES'`、`path` 的 `TypeError`。
- `model.resolve(action, currentBase)`：返回选中动作的 `{ base, supplement }`。`currentBase` 必须显式传入文本（允许空字符串），绝不回退到保存的 `base`。关闭补充能力时返回空 `supplement`，原文本仍保留，以便重新启用。
- `model.supports_supplement`：只读能力开关。`model.rules`、`model.toJSON()` 返回数据副本；`JSON.stringify(model)` 使用相同序列化结构。修改数据或切换开关时，用修改后的数据重新创建模型。

三个动作互不引用、不自动解决规则冲突。模型包含某动作的数据不代表启用或执行它；动作选择由项目决定。模型只提供结构和解析，业务基础规则、补充规则编辑、冲突处理及 UI 保存均由项目负责。

## 公共规则 UI

浏览器通过独立子路径导入，无框架和运行依赖。组件返回带 Shadow DOM 的 HTMLElement，样式自动加载并与宿主隔离。

```js
import { RulesModel } from '@agent-modules/prompt-composer';
import { renderRulesPanel } from '@agent-modules/prompt-composer/ui';

const model = new RulesModel(savedData);
container.replaceChildren(renderRulesPanel(model, {
  title: '任务 · 规则',
  currentBases: { generate: currentGenerate, revise: currentRevise, review: currentReview },
  onBack: () => showTask(),
}));
```

`renderRulesPanel(model, options = {})` 接受 RulesModel 或其 JSON 数据：

- 三标签顺序为生成、修订、审核；支持鼠标及方向键、Home/End 切换，各动作独立展示。
- `supports_supplement: false` 时不渲染补充规则区域；开启后显示补充原文。内容只读，提供逐卡复制与失败重试。
- `currentBases` 可选。传入时必须包含三动作的当前基础规则文本（可为空），通过 `model.resolve` 展示当前版本，不混入旧快照。仅传模型时，基础规则明确标为“基础规则快照”，该模式用于查看保存数据，不应作为当前执行规则展示入口。
- `title` 默认“规则”；可选 `onBack` 显示返回按钮。加载、路由、编辑和保存由接入项目负责。
- `copyText(text)` 可替换默认的浏览器 Clipboard API；可选 `document` 供 iframe 或测试注入。Node 导入包根和 UI 模块时均不读取 DOM，调用渲染函数时才需要 document。
- 样式可通过宿主容器上的 `--rules-background`、`--rules-card-background`、`--rules-color`、`--rules-muted`、`--rules-border`、`--rules-accent`、`--rules-selected-background` CSS 变量覆盖。多实例互不影响。

独立浏览器示例见 `examples/rules-panel.html`；用任意静态 HTTP 服务打开包目录即可运行，无需 meiji。直接使用浏览器原生 ESM 时，将示例中的相对 import 指向已安装包的 `src/index.js` 和 `src/ui/rules-panel.js`；npm 子路径导入由接入项目的构建器或 import map 解析。
