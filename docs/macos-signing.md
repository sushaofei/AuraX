# macOS 签名与公证

v1 打包可以先用 **ad-hoc 签名**（`signingIdentity: "-"`）打出 `AuraX.app`，真实 Developer ID 与公证后置。不要把证书、`.p12`、App Store Connect API Key 提交进 Git。

## 现在（无证书）

```bash
pnpm --filter @aurax/desktop tauri:build
```

Tauri 会按 `apps/desktop/src-tauri/tauri.conf.json` 使用 ad-hoc 身份和 `Entitlements.plist`。产物仅供本机安装验证，不能分发给未打开过 Gatekeeper 例外的机器。

最低系统：macOS 13。Bundle ID：`app.aurax.desktop`。展示名：AuraX。

## 以后（真实证书）

1. 在 Apple Developer 创建 Developer ID Application 证书。
2. 把身份名称写入环境变量，覆盖 ad-hoc：

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Example Ltd (TEAMID)"
export APPLE_CERTIFICATE_PASSWORD="..."   # 仅本机或 CI secret
```

3. 公证需要 App Store Connect API Key（`APPLE_API_KEY` / `APPLE_API_ISSUER` / `APPLE_API_KEY_PATH`），按 [Tauri macOS 签名](https://v2.tauri.app/distribute/sign-macos/) 配置。真实证书到位后把 `signingIdentity` 从 `"-"` 改成身份名，或继续用环境变量覆盖。

CI 里用 GitHub Secrets 注入上述变量，不要写进 `tauri.conf.json`。
