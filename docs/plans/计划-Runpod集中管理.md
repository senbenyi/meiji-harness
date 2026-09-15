# Runpod 集中管理

2026-09-15。用户授权：Runpod 专属内容集中到 `dsh-elysium/src/servers/providers/runpod/`；外部只保留配置与公共路由。

## 审计结论

1. 正式平台实现已位于该目录，但根目录 runpod 仍有重复 CLI、平台运维说明和旧制作脚本。
2. provider-contract.test.js 包含 Runpod 专属生命周期测试，应随平台归位；公共测试中的 Runpod 名称多数只是模拟 URL、配置或历史命名。
3. 用户明确原有 H3 模板属于 Runpod。五份模板必须连同全部 UI 元数据、三份档位配置、图构建和同步编译器整体归位；不得剥离 videopreview/fullpath 等原始字段。
4. 三个创作预设和教学 persona 把公共 ComfyUI 能力描述为 Runpod，需要解除平台命名绑定。
5. 原 third-cup-preview.mjs 是冻结旧入口：路径解析及单镜头 CLI 参数不匹配当前代码。作为历史材料归档，不作为当前生产入口；现行入口为 scripts/production-runner.mjs。
6. 历史任务回执/源快照及部署配置中的平台值属于证据与配置，不改写成新平台，不移动真实存储。

## 步骤

1. 将专属测试移入 provider/tests；旧制作脚本及运维说明移入 provider/legacy；删除重复根目录 CLI，以公共 server-service/tunnel 入口替代；补充 provider README。
2. 测试命令动态发现 provider/tests，构建和代码指纹排除测试/归档目录；物理删除验收由配置指定被删除平台，独立测试替代模块不依赖 Runpod。
3. 从 Git 恢复完整模板，逐字节核对五份模板与三份档位配置；迁入 provider/workflows，模型测试迁入 provider/tests；公共 workflow-sync 仅路由平台的 syncWorkflows。其他平台提供独立 buildGraph，不能依赖 Runpod 模板。
4. README、Harness 说明、AGENTS、standards 和进度更新；测试、构建、发布包验证，确认删除 Runpod 后业务仍可运行。

## 验收

- 平台专属执行、运维说明、测试与旧案例集中管理；根目录 runpod 不再保留。
- 公共源码/预设无 Runpod 专属路径、直接依赖或业务分支；允许登记值及平台可替换的验证配置。
- 原有 H3 模板和档位的完整内容与迁移前 Git 字节一致；已有元数据保留，模板不留在公共目录。
- 插件全量测试、Harness 测试、构建和 registry 导入通过。删除 Runpod 的临时副本仍完成实际本地 worker、恢复、批次和媒体验证。
- 不操作真实服务器或存储；不改写历史任务归属。

## 实施结果

已完成。插件 155 项测试、Harness 16 项测试通过；构建、打包、registry 导入、源码与发布指纹一致性、删除平台后的独立业务验收通过。详情见 `docs/implement/实施-Runpod集中管理.md`。

用户纠正后的边界：撤回此前“公共模板/剥离缓存”的设计。完整模板属于 Runpod，旧脚本也按原始 Git 内容保留为历史材料。
