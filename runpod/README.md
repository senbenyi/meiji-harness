# RunPod 模型服务

`runpod/` 只负责远端模型服务运维和 RunPod 生产脚本。

## 两台服务器与 SSH 密钥

不要混用两台服务器或共用同一个 `IdentityFile`：

| SSH 别名 | 平台 | 职责 | 本机私钥 |
| --- | --- | --- | --- |
| `veo-comfyui` | RunPod | ComfyUI，远端端口 `8188` | `~/.ssh/id_ed25519_veo_comfyui` |
| `veo-qwen38` | AutoDL | Qwen3.8，远端端口 `8000` | `~/.ssh/id_ed25519_veo_qwen38` |

私钥不得写入仓库、聊天或服务器配置页面；平台只配置对应的 `.pub` 公钥。公钥末尾的备注不参与认证，平台表单不接受备注时可只复制前两段：

```sh
awk '{print $1, $2}' ~/.ssh/id_ed25519_veo_comfyui.pub | pbcopy
awk '{print $1, $2}' ~/.ssh/id_ed25519_veo_qwen38.pub | pbcopy
```

### 新电脑配置顺序

先检查密钥是否存在，不要覆盖已有私钥：

```sh
ls -l ~/.ssh/id_ed25519_veo_comfyui ~/.ssh/id_ed25519_veo_qwen38
```

缺少时分别生成独立密钥：

```sh
ssh-keygen -t ed25519 -N '' -C veo-comfyui -f ~/.ssh/id_ed25519_veo_comfyui
ssh-keygen -t ed25519 -N '' -C veo-qwen38 -f ~/.ssh/id_ed25519_veo_qwen38
```

从各平台当前实例的连接页面取得实际主机、用户和端口，在 `~/.ssh/config` 配置：

```sshconfig
Host veo-comfyui
    HostName ssh.runpod.io
    User <RUNPOD_SSH_USER>
    IdentityFile ~/.ssh/id_ed25519_veo_comfyui
    IdentitiesOnly yes
    ServerAliveInterval 20
    ServerAliveCountMax 3

Host veo-qwen38
    HostName <AUTODL_SSH_HOST>
    User root
    Port <AUTODL_SSH_PORT>
    IdentityFile ~/.ssh/id_ed25519_veo_qwen38
    IdentitiesOnly yes
    ServerAliveInterval 20
    ServerAliveCountMax 3
```

设置权限：

```sh
chmod 700 ~/.ssh
chmod 600 ~/.ssh/config ~/.ssh/id_ed25519_veo_comfyui ~/.ssh/id_ed25519_veo_qwen38
```

将 `id_ed25519_veo_comfyui.pub` 添加到 RunPod SSH Public Keys，将 `id_ed25519_veo_qwen38.pub` 添加到 AutoDL SSH 公钥。新公钥不会自动进入已经运行的旧容器时，需在平台 Web Terminal 写入该容器的 `~/.ssh/authorized_keys`，或按平台规则重启、重新部署实例。

### 运行中 Qwen 容器更新公钥

不必重启服务器。先在本机复制 Qwen 公钥：

```sh
pbcopy < ~/.ssh/id_ed25519_veo_qwen38.pub
```

再通过平台 Web Terminal 进入正在运行的容器，创建 SSH 目录并追加刚复制的完整公钥：

```sh
install -d -m 700 /root/.ssh
touch /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
cat >> /root/.ssh/authorized_keys
```

粘贴公钥、按回车，再按 `Ctrl-D` 结束输入。平台登记的公钥和容器中的公钥都必须与本机密钥指纹一致：

```sh
ssh-keygen -lf ~/.ssh/id_ed25519_veo_qwen38.pub
```

最后分别验证，两个命令均须免密且退出码为 `0`：

```sh
ssh -o BatchMode=yes veo-comfyui true
ssh -o BatchMode=yes veo-qwen38 true
```

Qwen 验证成功后可直接建立本机隧道，无需重启 Harness：

```sh
node harness/scripts/tunnel.mjs qwen
curl -fsS http://127.0.0.1:18000/v1/models
```

如果出现 `Permission denied (publickey,password)` 或要求输入远端密码，先执行 `ssh -vvv <别名>`，确认 `Offering public key` 的文件和指纹与对应平台登记的公钥一致。不要通过删除 `BatchMode=yes` 绕过公钥问题。

## ComfyUI

在 ComfyUI 服务器执行：

```sh
node runpod/scripts/comfyui.mjs check
node runpod/scripts/comfyui.mjs start
node runpod/scripts/comfyui.mjs stop
node runpod/scripts/comfyui.mjs restart
```

ComfyUI 目录为 `/workspace/runpod-slim/ComfyUI`，端口为 `8188`，日志写入 `/workspace/runpod-slim/comfyui.log`。

## Qwen 隧道

在需要连接 Qwen 的服务器执行：

```sh
node runpod/scripts/tunnel.mjs qwen
```

执行前需在该服务器配置可用的 `veo-qwen38` SSH 目标。隧道将服务器本机 `127.0.0.1:18000` 转发到 Qwen 服务的 `127.0.0.1:8000`。

本机启动 Harness 时，`node harness/scripts/start.mjs` 会默认调用 `harness/scripts/tunnel.mjs qwen`。Qwen 隧道认证失败只会输出警告，不阻断 Harness 在 `127.0.0.1:3080` 启动。

## 生产脚本

`runpod/scripts/third-cup-preview.mjs` 是《第三杯咖啡》的冻结制作入口，使用说明见 [制作资料](../docs/implement/third-cup-preview/README.md)。
