# session入口迁移

- 类型：完整流程，项目模块移动与动态入口引用调整。
- 目标：drama/session.js移动到drama/src/session/index.js，插件导出与启动/复制验证继续正确加载。
- 非目标：不修改项目创建指导内容、工具注册行为，不改meiji或外部Harness代码。

## 验收标准与调研结论
| AC | 输入/状态 → 结果 | 状态/证据 |
|---|---|---|
| AC-1 | @drama/harness-plugin/session → 新目录apply，旧根文件移除 | 待验收；package exports负责宿主加载 |
| AC-2 | 启动/复制模板/新项目名 → 读取./session导出，不固定session.js | 待验收；configure脚本及两处工程验证原先写死路径 |
| AC-3 | 工具和指导注册/销毁 → 行为保持 | 待验收；shared-tools和create-project-tool现有测试 |

## 调用链与证据
cordis.patch.yml → @drama/harness-plugin/session → package.json.exports → src/session/index.js。
配置脚本在npm ci之前检查入口文件，仅读清单/文件存在性，不提前导入业务依赖；复制及工作区测试按清单加载入口。
已用GitNexus重构流程绑定实际仓库--repo .，索引有效；query/context/impact，apply UNKNOWN（动态插件需源码补查），verify-copy.run LOW/1，实际引用由rg与清单补查。

## 待用户决定
无。

## 改动
1. 移动session文件，改drama的./session导出和两处测试import。
2. configure-harness.sh验证./session导出的文件，verify-copy/workspace测试按清单导入。
3. 项目开发入口文档注明指导定义位置。

## 验证
基线drama59/工程7通过，0失败/取消。改后相关测试、verify:copy drama、bash语法和动态导出导入验证；diff、全范围图谱、最终索引。重启drama并只读验证页面加载。

## 验证结果
AC-1至AC-3通过：drama59/工程7测试通过，0失败/取消；根npm test 859通过、0失败、0取消。verify:copy drama通过（改目录/包名后离线安装与加载新入口），bash -n通过，项目包./session自引用解析通过。
已重启drama，真实页面只读检查通过，无浏览器错误，未写用户配置。git diff --check通过；全范围图谱检测无截断标志（含前序未提交修改），移动文件实际加载补查，最终刷新索引。

