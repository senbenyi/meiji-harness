# 运维 SSH 登录

模型服务使用 `settings.json` 中的 HTTP(S) 地址。以下 SSH 命令仅用于运维登录，不参与模型连接。

平台变更服务器的 SSH 端口或主机后，可更新本机直连别名：

```sh
node init/ssh.mjs veo-comfyui-direct 'ssh -p <端口> root@<主机>'
node init/ssh.mjs veo-qwen38-direct 'ssh -p <端口> root@<主机>'
```

脚本使用本机已有公钥登记目标主机，并验证直连别名。私钥和 `~/.ssh/config` 不存入仓库。换电脑时按需自行迁移运维 SSH 配置；Elysium 运行只需迁移 `~/.dsh/storages/elysium`。
