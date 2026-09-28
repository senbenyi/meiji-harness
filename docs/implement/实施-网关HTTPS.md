# 网关HTTPS实施记录

## 已修改文件
- `meiji/config/models.json` — `baseUrl` 改为 `https://43.154.247.11/v1`
- `meiji/tests/models.test.js`、`meiji/tests/image.test.js` — 默认地址断言改为 https

## 验收标准核对
| AC | 状态 | 验证方式与证据 |
|---|---|---|
| AC-1 | 通过 | `git diff` 仅 `baseUrl` 一行变化 |
| AC-2 | 通过 | 两个测试文件 15/15；全量 247 通过 / 19 失败，失败项与基线一致 |
| AC-3 | 未验收 | 开发沙箱代理拦截该 IP，无法验证 TLS |

## 测试
基线 246 通过 / 20 失败（含既有不稳定测试）；改动后 247 通过 / 19 失败，无新增失败。

## 人工待办
- [ ] 本机执行 `curl -sS https://43.154.247.11/v1/models -o /dev/null -w '%{http_code}\n'`：证书报错或连接失败说明网关未启用 HTTPS，需服务端配置证书（IP 证书少见，通常需绑定域名后把 `baseUrl` 改为域名）。
- [ ] 运行时 `$DSH_HOME/storages/meiji/models.json` 若已存在，在面板设置里把网关地址改为 https。
