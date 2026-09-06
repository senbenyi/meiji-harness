# llm-dsh-plugins
deepseek harness 插件集合仓库；

## 编码任务
1. 在完成功能的前提下，以精简并删除历史冗余代码为荣，以堆砌重复实现为耻。
2. 优先使用 `andrej-karpathy-skills`
3. 修改前先定位入口、引用关系和验证方式。
3. 移动或重命名文件后，全仓更新相关引用。
4. 核心改动、优化生成可追溯文档到 `docs`。

## 项目结构
- 函数工具插件：`dsh-elysium-tools/` 
- 页面展示插件`dsh-elysium-ui/` 
- 废弃插件`dsh-elysium/`

## 构建、开发命令
- `pnpm install --frozen-lockfile --ignore-scripts`：按锁文件安装依赖，不执行生命周期构建脚本。
- `pnpm build`：生成可分发的构建产物。
- `pnpm package:registry` 组装 registry 包。

## 部署与安全
部署工具插件到服务器 `scripts/deploy_dsh_elysium_tools.sh` 
