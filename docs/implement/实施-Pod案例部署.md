# Pod 成品案例部署

2026-09-14，将 `5e14b7b` 的 Elysium 构建与《第三杯咖啡》离线案例部署到现有 Pod `36we4j3zo503js`。部署目录 `/workspace/harness`，启动命令 `sh /workspace/harness/start.sh`。

运行时为 Node.js 24.20.0、Harness 0.1.2-rc.1、pnpm 10.32.1。Node 下载包通过官方 SHASUMS 校验。插件位于 `packages/dsh-elysium`，运行数据位于 `home/storages/elysium`，部署记录位于 `deployment.json`。未复制本机凭据、环境变量文件或开发权限配置；没有部署新的模型服务。

发布包为63,313,631字节，传输SHA-256：`d4d29625ebca967cc38203b6f48052bc7d178d044910450d73bf1aed0027e987`。服务器重新校验126份媒体，共63,038,949字节，全部哈希与manifest一致；6幕、120镜、4张锚点、2份交付全部登记成功。镜头使用真实72帧剪辑版，73帧原始归档的缺口保持原记录。

Harness 版本拒绝直接公网监听，因此保持 `127.0.0.1:3080`；`proxy.mjs` 使用现有8188入口转发HTTP与WebSocket。根页面使用Harness原生登录，其余请求先由Harness检查会话。没有关闭认证，也没有修改平台端口或权限配置。外部地址：`https://36we4j3zo503js-8188.proxy.runpod.net/`。未登录的页面及项目API均返回401；本轮按照用户“不访问密码和权限”的要求，尚未提取首次登录链接，浏览器验收留待用户登录。

当前Pod为容器盘部署；以上目录属于当前容器。已确认文件和服务运行，不将其表述为持久卷部署或模型推理已就绪。
