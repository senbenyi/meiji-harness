# SSH 服务器切换

## 使用

容器更换后，更新直连别名：

```bash
node init/ssh.mjs veo-comfyui-direct \
  'ssh -p 24564 root@connect.westb.seetacloud.com'
```

```bash
node init/ssh.mjs veo-qwen38-direct \
  'ssh -p 23237 root@connect.westd.seetacloud.com'
```

登录：

```bash
ssh veo-comfyui          # 经香港中转（默认，项目隧道使用）
ssh veo-qwen38
ssh veo-comfyui-direct   # 直连 seetacloud 网关（回退）
ssh veo-qwen38-direct
```

## 香港中转

本机 → seetacloud 网关跨境丢包严重，默认经香港 `veo-hk`（43.154.247.11）中转。GPU 容器无入站能力，由 GPU 主动向香港建立反向隧道：

```text
本机 ──ssh──> veo-hk:22 ─┬─ 127.0.0.1:22001 ⇐ -R ⇐ veo-comfyui:22
                         └─ 127.0.0.1:22002 ⇐ -R ⇐ veo-qwen38:22
```

| 位置 | 内容 |
|------|------|
| 本机 `~/.ssh/config` | `veo-hk`；`veo-comfyui`/`veo-qwen38` 为 `127.0.0.1:2200x` + `ProxyJump veo-hk` + `HostKeyAlias` |
| 香港 | 受限用户 `tunnel`（nologin、`ForceCommand /bin/false`）；`authorized_keys` 每机一行 `permitlisten="127.0.0.1:2200x"`；`/etc/ssh/sshd_config.d/10-relay.conf` |
| GPU | `/root/.ssh/id_ed25519_relay`（本机生成，不外传）；`/root/autodl-tmp/relay/tunnel.sh`（flock 单实例、断线 10 秒重连）；`/root/.bashrc` 第 2 行 `# relay-tunnel` 登录钩子 |

容器被平台重启后，经 `-direct` 别名或 AutoDL 网页终端登录一次即恢复隧道。

### 新容器接入

1. `node init/ssh.mjs <alias>-direct '<平台 SSH 命令>'` 打通直连。
2. GPU 上 `ssh-keygen -t ed25519 -N '' -f /root/.ssh/id_ed25519_relay`；`ssh-keyscan -t ed25519 43.154.247.11` 的指纹须为 `SHA256:WIGLYIOwQuWfD2gcqnQYYwby47Pd+6zt/QRta2bWOaw`，核对后写入 `/root/.ssh/known_hosts`。
3. 香港 `/home/tunnel/.ssh/authorized_keys` 中替换该机旧行为 `permitlisten="127.0.0.1:2200x" <新公钥>`。
4. 从已有 GPU 复制 `tunnel.sh`，在 `.bashrc` 第 2 行加入钩子（见 `docs/implement/实施-香港中转网络.md`），执行一次该行启动。
5. 新容器主机密钥变化时，更新本机 `~/.ssh/known_hosts` 中 `veo-comfyui`/`veo-qwen38` 条目。

### 回退

`cp ~/.ssh/config.bak ~/.ssh/config` 恢复直连，项目中重新连接即可。
