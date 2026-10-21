# MASTER2 网页版（开发工作台）

AuraX 网页与 MASTER2 上的 AuraClaw 联用。入口仅监听主机 `127.0.0.1:1420`，
按用户选择通过 SSH 隧道访问，不开放公网端口，不改动现有后端或数据库账号。

```bash
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:11420:127.0.0.1:1420 <MASTER2-SSH别名>
# 浏览器打开 http://127.0.0.1:11420
```

本机私有运维记录提供使用现有资产文件/密钥的重开隧道脚本。SSH 连接承担开发入口的访问认证，
终端关闭会断开页面连接；后台任务仍由 AuraClaw 执行，重新连接可从历史页恢复。

## 连接方式与兼容修复

旧网页只发送测试身份 Header，直接反代到已启用验签的 AuraClaw 会得到 401。
`deploy/dev_web.py` 是显式启用的开发接入层：使用同机已有 workload/signing Secret，
为每个公开 API 请求签发独立、120 秒的 Agent Context，按任务路径绑定 Session。
保持幂等键、预期版本、查询参数、上传内容、状态码及 SSE / Last-Event-ID；不代理内部接口。
后端验签继续开启，Provider/数据库 Secret 不进入此容器，任何 Secret 都不进入静态资源或浏览器存储。

此入口固定使用 `platform / local-org / local-user`，拒绝浏览器伪造其他身份；
`/aurax/environment` 只返回这三个公开标识。受管构建先通过 SDK 加载服务端身份，再加载业务页面；
配置失败时停止加载，不退回不可信测试头。配置页显示固定身份，不提供会失效的本地身份修改框。
原桌面壳、Vite 开发与旧 nginx 部署不设置该构建标志，继续保持原有测试身份配置功能。

接入层拒绝非 localhost Host、跨域 Origin/Sec-Fetch-Site、内部路径与超过 16 MiB 的请求；
固定 upstream、禁止重定向，不接受浏览器传来的 workload/签名凭据。
这是 SSH 受限开发入口，不可直接改绑公网；上线完整登录与 HTTPS 需要单独接入上游身份服务。

## 构建与部署

使用 Node >=22 与仓库指定 pnpm 10.33.0，冻结锁文件安装；workspace 只允许 esbuild 的必要构建脚本。
本次修复补上了 pnpm 的构建许可，依赖锁文件没有变化。

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
VITE_AURAX_UPLINK=same-origin VITE_AURAX_MANAGED_IDENTITY=true pnpm build
```

发布内容为 `apps/desktop/dist`、`deploy/dev_web.py`、`compose.master2.yml`，均不包含环境文件或凭据。
MASTER2 每个版本保存在 `/data4/aurax-master2/releases/<commit>`；运行配置 `.env` 私有且不入 Git：

```dotenv
AURAX_RUNTIME_IMAGE=sha256:602e4ab7fa0964bec0e145bd4378dda96faacb449e7b85dac5e246d5f5007131
AURACLAW_SECRET_DIR=/data4/auraclaw-e2/source/.runtime/compose-secrets
```

当前复用已经部署、核验过的 AuraClaw Python runtime image，包含可用的 FastAPI/httpx/uvicorn 与签名器，
`pull_policy: never` 不会拉取浮动镜像。容器仅挂载两个选定认证 Secret，不复制整个后端环境文件。
以原非 root 用户、只读根、cap-drop ALL、no-new-privileges 运行，限 1 CPU / 512 MiB / 128 PID。
只加入现有 edge 网络，经 `ingress:8080` 访问公开 Task/Streaming API。

```bash
cd /data4/aurax-master2/releases/<commit>
docker compose -f compose.master2.yml config --quiet
docker compose -f compose.master2.yml up -d </dev/null
docker compose -f compose.master2.yml ps
```

宿主 `/data4` UUID、1420 端口未占用、固定镜像和现有 12 个后端进程已在发布前核验。
新版本保持前一 release 及其 `.env`；回滚在前一版本目录执行相同 Compose up，
不删除后端数据、不重启整机、不使用 down -v。重开 SSH 隧道即可继续使用页面。

## 验证范围

- TypeScript、生产构建与 SDK 测试；ESLint 无错误，ChatView 保留 5 项既有 hooks 警告。
- 可选 Python 接入层测试：使用固定 AuraClaw 开发依赖环境执行 `pytest tests/test_dev_web.py`，
  覆盖签名与 Session 绑定、伪造/跨域/Host/内部路径拒绝、幂等与版本、SSE、错误保留及上传限额。
- 实际浏览器在 SSH 地址完成聊天与流式结果、执行轨迹、历史查询、单轮异步任务结果与自动结束；
  MCP/Skill 管理接口 200，空目录按真实空状态展示，不把错误伪装为无数据。
- 完整 Playwright 回归 35 项通过，覆盖 390/760px 窄窗口及原有宽屏交互；修复主导航与轨迹挤压/裁切，对话与轨迹在窄窗口纵向排列。
- 审批菜单截图使用 Playwright 独立输出目录，修复旧测试依赖 macOS `/private/tmp` 而在 Linux CI 失败的问题。
- 最终 commit/构建摘要、容器、运行 ID 的证据保存在部署记录。

2026-10-21 实际会话：聊天 `ses_9630a8c509e842ef9be2e1946b6dcc1c` 已完成；
任务 `ses_0f6766a16a144312b391eddb5846b274` 已完成且 Session 自动关闭。
测试请求只要求返回验证文本，没有工具或业务写入。
MCP/Skill 目录为空，本次没有凭空注册外部系统、发布技能或验证不存在的下游调用。

此部署仍是开发环境。既有 AuraClaw 供应链生产发布门禁不由网页验证解除，
这套接入层不改变其生产身份/依赖政策。
