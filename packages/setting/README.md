# 设置

纯 ESM、零运行时依赖。`SettingsModel` 校验语言与各用途的模型选择，不内置任何业务模型名称。本地文件保存和设置页通过独立入口使用，不连接业务服务。

```js
import { SettingsModel } from '@agent-modules/setting';

const spec = {
  language: {
    field: 'output_language',
    default: 'zh-CN',
    options: [{ value: 'zh-CN', label: '简体中文' }, { value: 'en', label: 'English' }],
  },
  models: {
    session: { options: [{ value: 'local', label: '本地' }, { value: 'remote', label: '远程' }], default: 'remote' },
    draft: { options: [{ value: 'local', label: '本地' }, { value: 'remote', label: '远程' }] },
  },
};

const model = new SettingsModel({ draft: { model: 'local' } }, spec);
model.toJSON();
```

## 接口

`new SettingsModel(value = {}, spec)` 按 `spec` 读取选择：

- `spec.language` 可选。`options` 为 `{ value, label }` 列表，`default` 必须落在其中。缺省字段名是 `output_language`。未提供的语言使用默认值；不在选项内时抛出 `请选择有效语言`。
- `spec.models` 至少包含一个用途。每个用途保存 `{ model }`。`default` 可省略；省略时该用途必须传入有效模型。`legacy` 把旧值映射到当前选项，映射发生在校验之前。
- 未声明的输入字段被忽略。同一用途不能用另一个用途的模型值冒充。

`toJSON()` 返回数据副本，`JSON.stringify(model)` 使用同一结构。修改选择时用新数据重新创建模型。非法目录或选择抛出 `code: 'INVALID_SETTINGS'` 的 `TypeError`，并带 `path`。

选项、默认值和旧值映射由调用方维护。模型不决定这些选择如何展示或发给哪个服务。用途和语言都可以带 `title`，设置页用它做字段名称。

## 本地保存

```js
import { createSettingsStore } from '@agent-modules/setting/store';

const store = createSettingsStore('./settings.json', {
  spec,
  defaults: { endpoint: 'http://127.0.0.1:9', draft: { model: 'local' } },
});
await store.write({ output_language: 'en' });
```

`read()` 在文件不存在时使用 `defaults`（对象或异步函数），不创建文件。返回值包含校验后的选择，以及原来的其他字段。`write(value)` 先与当前文件合并，再校验；无效选择不会改文件。同一进程内按绝对文件路径串行执行读取、合并和写入，多个 store 实例也共用队列；一次失败不阻断后续保存。写入使用同目录唯一临时文件，再替换目标文件，清理临时文件，并把权限设为 `0600`。此队列不提供跨进程文件锁；同一设置文件应由一个进程管理。

## 设置页

```js
import { renderSettingsPanel } from '@agent-modules/setting/ui';

const panel = renderSettingsPanel(spec, { store, onBack: () => showHome() });
document.querySelector('main').append(panel);
await panel.ready;
```

页面分为「语言」和「模型」。字段来自 `spec`，选择后立即保存，没有单独的保存按钮。保存失败时恢复原选项并显示原因。`setBusy(true)` 冻结全部分组。`value` 可代替 `store` 只在内存中修改。样式位于 Shadow DOM，与宿主隔离。
