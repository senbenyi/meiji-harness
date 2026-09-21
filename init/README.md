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
ssh veo-comfyui          # 经香港中转（仅运维登录）
ssh veo-qwen38
ssh veo-comfyui-direct   # 直连 seetacloud 网关（回退）
ssh veo-qwen38-direct
```

## 香港网关

项目服务由本机直连香港 `veo-hk`（43.154.247.11）的 HTTP 网关。GPU 容器主动向香港建立反向隧道；SSH 别名只用于运维登录：

```text
本机 ──HTTP:80──> 香港 nginx ─┬─ 127.0.0.1:26016 ⇐ -R ⇐ veo-comfyui:6016
                              └─ 127.0.0.1:28000 ⇐ -R ⇐ veo-qwen38:8000
运维 SSH ──> veo-hk:22 ─┬─ 127.0.0.1:22001 ⇐ -R ⇐ veo-comfyui:22
                         └─ 127.0.0.1:22002 ⇐ -R ⇐ veo-qwen38:22
```

| 位置 | 内容 |
|------|------|
| 本机 `~/.dsh/storages/elysium/config/settings.json` | ComfyUI 为 `http://43.154.247.11/comfy`，聊天为 `http://43.154.247.11/qwen/v1` |
| 本机 `~/.ssh/config` | 运维用 `veo-hk`；`veo-comfyui`/`veo-qwen38` 为 `127.0.0.1:2200x` + `ProxyJump veo-hk` + `HostKeyAlias` |
| 香港 | `/etc/nginx/sites-available/gateway` 监听 80，按 `/comfy/`、`/qwen/` 转发；受限用户 `tunnel` 的 `authorized_keys` 每机允许对应 `2200x` 与 `26016`/`28000`；`/etc/ssh/sshd_config.d/10-relay.conf` |
| GPU | `/root/.ssh/id_ed25519_relay`（本机生成，不外传）；`/root/autodl-tmp/relay/tunnel.sh`（flock 单实例、断线 10 秒重连）；`/root/.bashrc` 第 2 行 `# relay-tunnel` 钩子的 `RELAY_ARGS` 增加服务端口 `-R` |

容器被平台重启后，经 `-direct` 别名或 AutoDL 网页终端登录一次即恢复隧道。

### 换电脑

香港与 GPU 端无需改动。项目运行时只需：

1. 安装 Node 与 pnpm，克隆本仓库。
2. 整体拷贝原电脑 `~/.dsh/storages/elysium` 到新电脑同一位置（含服务器登记、项目与素材）；第三方模型所需环境变量另行配置。
3. `node harness/scripts/install.mjs`，再启动 Harness，设置页点"连接"。

如需运维登录，再复制 `~/.ssh/id_ed25519_veo_hk`、`id_ed25519_veo_comfyui`、`id_ed25519_veo_qwen38`（含 `.pub`）并执行 `node init/relay.mjs`，生成并核对 SSH 别名与主机公钥。

### 新容器接入

1. `node init/ssh.mjs <alias>-direct '<平台 SSH 命令>'` 打通直连。
2. GPU 上 `ssh-keygen -t ed25519 -N '' -f /root/.ssh/id_ed25519_relay`；`ssh-keyscan -t ed25519 43.154.247.11` 的指纹须为 `SHA256:WIGLYIOwQuWfD2gcqnQYYwby47Pd+6zt/QRta2bWOaw`，核对后写入 `/root/.ssh/known_hosts`。
3. 香港 `/home/tunnel/.ssh/authorized_keys` 中替换该机旧行，允许运维端口 `permitlisten="127.0.0.1:2200x"` 和服务端口 `permitlisten="127.0.0.1:26016"`（ComfyUI）或 `permitlisten="127.0.0.1:28000"`（qwen38）。
4. 从已有 GPU 复制 `tunnel.sh`，在 `.bashrc` 第 2 行加入钩子与服务端口 `RELAY_ARGS`：ComfyUI 同时含 `-L 127.0.0.1:7890:127.0.0.1:7890 -R 127.0.0.1:26016:127.0.0.1:6016`，qwen38 含 `-R 127.0.0.1:28000:127.0.0.1:8000`（见 `docs/implement/实施-香港中转网络.md`），执行一次该行启动。
5. 新容器端口或主机公钥变化时，更新 `init/relay.json` 的 `direct`/`host_key`，再更新本机 `~/.ssh/known_hosts` 旧条目后执行 `node init/relay.mjs`；别名字段变化会改变 Elysium 登记身份，需重新绑定。

### 回退

`cp ~/.dsh/storages/elysium/config/settings.json.bak-gateway-20260921 ~/.dsh/storages/elysium/config/settings.json && node harness/scripts/start.mjs` 恢复项目旧连接。设置页重新连接即可建立本机 SSH 隧道。
