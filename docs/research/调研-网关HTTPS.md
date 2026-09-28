# 网关HTTPS调研

## 结论
- AC-1 — 已确认 — 默认网关地址来自 `meiji/config/models.json` 的 `baseUrl`，当前为 `http://43.154.247.11/v1`。
- AC-2 — 已确认 — 读取默认配置并断言地址的测试只有 `models.test.js:13`、`image.test.js:39-40`；其余测试使用写死的假地址，不读配置。
- AC-3 — 未验收 — 网关 443 端口是否提供有效证书无法从开发沙箱验证（代理拦截该 IP），需在本机验证。

## 规格
- 目标：默认网关改用 HTTPS，密钥与提示词不再明文传输。
- 非目标：1. 不在代码中强制拒绝 http（本地调试仍可用）；2. 不改运行时 `storages/meiji/models.json`；3. 不改外部接口文档。
- 验收标准：
  - AC-1：`config/models.json` 的 `baseUrl` 为 `https://43.154.247.11/v1`。
  - AC-2：相关测试随之更新，`npm test` 不新增失败。
  - AC-3：本机 `curl https://43.154.247.11/v1/models` 能完成 TLS 握手（证书校验通过）。

## 调用链
```text
modelStore.read() → 运行时 models.json 存在则优先 → 否则 defaults() → config/models.json.baseUrl
→ gatewayBaseUrl() 校验 http/https → generate/gateway.js 所有请求
```

## 证据
| 来源（文件:行） | 支持的结论 |
|---|---|
| `meiji/models/router.js:gatewayBaseUrl` | 同时接受 http 与 https |
| `meiji/server/data/models.js:11` | 运行时文件优先于默认配置 |

## 问题
| AC | 预期 | 实际 | 根因 |
|---|---|---|---|
| AC-1 | https | http | 默认配置写死 http |

## 待用户决定
若网关未启用 HTTPS 或证书不匹配 IP，需服务端配置证书（通常需要域名）；否则改动后生成请求会失败。
