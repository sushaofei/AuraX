# AuraX

AuraX 是 AuraClaw 的 **macOS 工作台**：发命令、查投影、订 SSE、管理 MCP 与 Skill。它不保存任务事实，不执行 Agent，不定时触发。

展示名 **AuraX**。副标题可用「AuraClaw 工作台」。Bundle ID：`app.aurax.desktop`。

## v1 范围

- 连接设置：只改 AuraClaw base URL。身份写死 `platform` / `local-org` / `local-user`。
- **对话（流式）**：`POST /v1/tasks`（`source=chat`）→ SSE `model.output.delta` 实时展示 → transcript 终态对齐；助手回复用 `react-markdown` + `remark-gfm`。
- **任务（API 调试）**：`POST /v1/tasks`（异步 202 + `GET /result?wait=true`）或 `POST /v1/tasks/sync`（同步）；以 result 回调为权威结果；含执行轨迹面板。
- Session 历史：`GET /v1/tasks?kind=chat`，按本机来源标记区分「对话」与「任务」Tab。关窗口 ≠ 取消任务。
- MCP 管理：登记 / 测试 / 启停 / 对账 / 退役 / 列出 Catalog tools。Secret 只填 `credential_ref`。
- Skill 管理：只读目录 + 启停；对话页与任务页可勾选「允许使用的 Skill」（租户目录，下一轮 Run 生效）。无发布入口。
- 对话执行轨迹：任务页右侧可折叠面板按 Run 展示模型、MCP/Tool、Skill、Resource、审批与状态节点；历史以 AuraClaw Activity Query 为准。

## 明确不做

- 本机 Timer / cron / 漏跑补跑
- 直连 AuraMCP 或 `/internal/v1/*`
- 完整登录 / 切换租户
- Skill 编辑器、stdio MCP 本机托管

## 开发

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm e2e
pnpm --filter @aurax/desktop dev
```

开发时「连接」里的 AuraClaw URL **留空**，Vite 会把 `/v1` 代理到本机 Ingress `http://127.0.0.1:8080`（`/v1/streams/*` 去 Streaming Gateway，其余去 Task API）。不要直连 `:8000`，否则任务能通、SSE 会 404。其他主机上的 AuraX 在「连接」填 `http://<跑 AuraClaw 的机器>:8080`。打包后的桌面壳默认连 `http://127.0.0.1:8080`。需要桌面壳时先安装 Rust，再：

```bash
pnpm --filter @aurax/desktop tauri:dev
```

## 工程

```
apps/desktop          Tauri 2 + React 19 + Vite
packages/claw-sdk     AuraClaw HTTP/SSE 客户端（无 React / Tauri）
```

UI 不直接 `fetch`。所有请求经 `@aurax/claw-sdk`，由 SDK 注入开发身份头与幂等键。

macOS 打包先用 ad-hoc 签名，真实 Developer ID / 公证见 `docs/macos-signing.md`。阶段门禁见 `docs/开发阶段校验清单.md`。
执行轨迹的信息架构、恢复与安全规则见 `docs/对话执行轨迹产品方案.md`。

## 测试环境（DEV_WEB）

AuraClaw 后端在 `DEV_SERVICE`（`10.244.16.131:8080`）。`DEV_WEB`（`10.244.16.130`）上 **`:80` 保留给站点主页**；AuraX 单独监听 **`:1420`**（独立 nginx 容器，同源反代 `/v1` → AuraClaw）。

```bash
# 本机一键（构建 + 发布到 DEV_WEB :1420；不修改 :80 主页）
./scripts/dev_web_deploy.sh

# 若 :80 主页被误覆盖，单独恢复（不影响 :1420 AuraX）
./scripts/restore_dev_web_homepage.sh

# 或服务器上用 compose（默认映射 1420:80）
cp .env.test.example .env.test
docker compose --env-file .env.test -f compose.test.yml up --build -d
```

打开 `http://10.244.16.130:1420/`。连接页 **AuraClaw URL 留空**（`VITE_AURAX_UPLINK=same-origin`）。桌面 Tauri 包仍默认 `http://127.0.0.1:8080`。
