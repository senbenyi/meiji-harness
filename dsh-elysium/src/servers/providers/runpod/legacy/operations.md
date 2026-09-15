> 历史归档：本页中的旧命令、目录和链接已失效。当前平台操作见 [当前说明](../README.md)；Qwen 隧道使用 `harness/scripts/tunnel.mjs`。

# RunPod 模型服务

`runpod/` 保留旧运维命令和冻结生产案例。完整平台实现位于 [providers/runpod](../dsh-elysium/src/servers/providers/runpod/README.md)，包括配置、连接、执行契约和服务进程管理。公共业务不依赖此目录。




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

上述命令转发到平台模块；也可使用 `node dsh-elysium/scripts/server-service.mjs runpod <action>`。进程管理只停止本模块通过 PID 文件登记且身份匹配的进程，已有外部启动进程须由原启动者管理。

ComfyUI 目录为 `/workspace/runpod-slim/ComfyUI`，端口为 `8188`，日志写入 `/workspace/runpod-slim/comfyui.log`。

## Qwen 隧道

旧命令保留为本机公共隧道入口的转发；建议在 Harness 所在本机执行：

```sh
node runpod/scripts/tunnel.mjs qwen
```

执行前需在该服务器配置可用的 `veo-qwen38` SSH 目标。隧道将服务器本机 `127.0.0.1:18000` 转发到 Qwen 服务的 `127.0.0.1:8000`。

本机启动 Harness 时，`node harness/scripts/start.mjs` 会默认调用 `harness/scripts/tunnel.mjs qwen`。Qwen 隧道认证失败只会输出警告，不阻断 Harness 在 `127.0.0.1:3080` 启动。

## 生产脚本

`runpod/scripts/third-cup-preview.mjs` 是《第三杯咖啡》的冻结制作入口，使用说明见 [制作资料](../docs/implement/third-cup-preview/README.md)。
