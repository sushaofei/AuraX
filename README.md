# AuraX

AuraX 是 AuraClaw 的 **macOS 工作台**：发命令、查投影、订 SSE、管理 MCP 与 Skill。它不保存任务事实，不执行 Agent，不定时触发。

展示名 **AuraX**。副标题可用「AuraClaw 工作台」。Bundle ID：`app.aurax.desktop`。

## v1 范围

- 连接设置：只改 AuraClaw base URL。身份写死 `platform` / `local-org` / `local-user`。
- 实时对话：`POST /v1/tasks`（`source=chat`）→ SSE → transcript / result 回填；助手回复与 SKILL.md 用 `react-markdown` + `remark-gfm` 渲染。
- Session 历史：`GET /v1/tasks?kind=chat`，打开即恢复。关窗口 ≠ 取消任务。
- MCP 管理：登记 / 测试 / 启停 / 对账 / 退役 / 列出 Catalog tools。Secret 只填 `credential_ref`。
- Skill 管理：只读目录 + 启停；对话页勾选「允许使用的 Skill」（租户目录，下一轮 Run 生效）。无发布入口。

## 明确不做

- 本机 Timer / cron / 漏跑补跑
- 直连 AuraMCP 或 `/internal/v1/*`
- 完整登录 / 切换租户
- Skill 编辑器、stdio MCP 本机托管

## 开发

```bash
pnpm install
pnpm --filter @aurax/claw-sdk test
pnpm --filter @aurax/desktop typecheck
pnpm --filter @aurax/desktop dev
```

开发时「连接」里的 AuraClaw URL **留空**，Vite 会把 `/v1` 代理到本地 Ingress `http://127.0.0.1:8080`（`/v1/streams/*` 去 Streaming Gateway，其余去 Task API）。不要直连 `:8000`，否则任务能通、SSE 会 404。打包后的桌面壳默认连 `http://127.0.0.1:8080`。需要桌面壳时先安装 Rust，再：

```bash
pnpm --filter @aurax/desktop tauri:dev
```

## 工程

```
apps/desktop          Tauri 2 + React 19 + Vite
packages/claw-sdk     AuraClaw HTTP/SSE 客户端（无 React / Tauri）
```

UI 不直接 `fetch`。所有请求经 `@aurax/claw-sdk`，由 SDK 注入开发身份头与幂等键。
