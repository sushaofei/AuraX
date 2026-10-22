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

## 评测结果展示（2026-10-21）

导航“评测”通过 SDK 读取同源 `GET /aurax/evaluations`，只读展示已发布的运行，
不启动评测或自动调度。当前范围是固定测试工作台内的 dev 联调，不能作为完整基准排行榜。
SDK 与界面独立于 benchmark 执行器，AuraClaw 生产入口不导入 evaluation 包，不增加数据库耦合。

发布器 `deploy/evaluation_reports.py` 在评测宿主上显式选择 run 目录，
仅打开 manifest 与严格匹配的 `attempt_数字.json`，从字段白名单构造公开报告。
不打开 trace，不发布任务正文、答案、完整 usage、异常文本、环境地址或凭据。
任务 ID 仅用于核对样本，保留失败记录；缺失尝试的分母来自 manifest，未完成运行不显示成功率。
配置混用、重复 task/trial、非法数值或版本会阻止发布，旧报告保留。
报告 `schema_version=1`，每轮独立保存配置、上游版本、数据指纹与执行 profile，支持任意 benchmark 名称。
新增执行器仍需分别开发，不因可显示新名称就宣称已接入该基准。

在 MASTER2 使用**已验证运行时**发布两个现有 E2 最终 run（没有新模型调用）：

```bash
mkdir -p /data4/aurax-master2/evaluations
# 在 AuraClaw runtime 内执行此发布器，挂载原始目录供一次性导出；Web 本身不挂载原始目录。
python deploy/evaluation_reports.py \
  --run /private-results/eval_4a8ae70da446439795a4b3eb83007c12 \
  --run /private-results/eval_89aa41a3dc1749baa8023276e9dfb2b7 \
  --output /published/report.json
```

实际部署时目录先由管理员创建；一次性导出容器使用 root 读取原本 root-only 的原始文件，
设置 network=none、只读根、cap-drop ALL，仅公开输出目录可写，不改变原始文件权限。
Web 服务继续以 non-root 运行。
Web 只读挂载 `${AURAX_EVALUATION_DIR:-/data4/aurax-master2/evaluations}`，
接入层再次执行严格 schema 验证，出现未知字段也拒绝返回，防止误将原始记录作为公开报告。
文件不存在返回 404，格式损坏返回 503（无私有内容）；页面区分未接入、真实空集合、加载失败及旧缓存。
没有客户端文件路径参数，固定部署身份、同源与 localhost 限制同样适用。
当前是 SSH 开发部署接口，未作为生产/跨租户报告 API；生产化需另行建立授权和报告发布流程。

初始报告应为 τ-bench retail dev **1/2**、AppWorld dev **2/2**，共四次尝试，执行异常零次。
模型 `qwen3.5-122b-a10b` 是别名，未验证不可变快照，总费用未知；不提供完整 SGC 或稳定 pass^k 结论。
页面导入时间是报告生成时间，不冒充评测执行时间；刷新只重读已发布报告，不触发重新评测。
更新报告需重新显式导出并原子替换。Web 回滚不会删除已发布报告。

## E3 重复评测与独立复评展示

E3 通过显式 `protocol=e3-heldout-v1` 与 E2 联调分开显示，样本数量、三次重复、完整计划分母与
pass^1/2/3 同时展示。pass^k 表示同一任务 k 次均成功的估计，包含异常的不成功尝试；未跑齐时不显示。
界面显示模型别名未冻结快照、缺少配对对照及三次重复的证据限制，不称作完整 benchmark 排名。

AppWorld `official-metrics.json` 是在独立进程对各实验的最终数据库执行固定官方 evaluator 后产生的
私有收据。发布器仅接收 verified=true，核对任务/重复覆盖、两份独立官方终态参考逐次是否一致，并重算完整场景
子集的 TGC/SGC 后才发布。发布的是按 trial 的子集指标，不冒充完整 dev/test SGC。

`independent_reward` 与原始 `official_reward` 分开保存。模型服务异常导致原始奖励未知时，
可以独立检查其已保存的最终环境，但不能借复评把运行异常改成成功。页面同时显示未知原始奖励、
独立复评值及运行异常；严格成功率仍使用原记录 success 和完整分母。收据不一致会阻止发布。

私有原始记录、模型服务错误内容、任务/解答/轨迹和部署地址不进入公开报告。
初始准入不足的诊断轮保留在运维证据中，并明确排除能力分数；正式展示不从诊断轮挑选成功样本。
修正轮源清单固定，停批后如人工补齐，只执行未启动的 task/trial，校验既有文件哈希保持不变，
保留既有失败和原始 summary，另写 completion-summary；发布器从全部实际 attempt 重建报告。


### 报告 v2 与最终成绩裁决

发布器输出 schema_version=2，新读端兼容旧 v1。旧接入层拒绝 v2 的新增字段，因此部署先保存
旧报告、启动新代码并确认可读旧报告，再原子发布新报告；回滚旧代码时必须一起恢复归档的v1报告。
不在旧服务运行时先覆盖活动报告。原始 SDK 产物不挂入网页，不回写旧 record 或 trace。

E3 AppWorld 的正式展示只采用 `two-post-close-official-graders` 的最终裁决，
`scoring_basis=post-close-official`；将旧运行中 `success` 保存在 `episode_success`，
`official_reward` 保留旧读数，`independent_reward` 保存官方终态目标结果。
页面成功率按最终目标和 Runtime 完成共同计算，明确显示与旧读数不同的判定数量。
两份官方参考不一致、覆盖不齐、来源不全或更正数量错误均拒绝发布。

本轮 AppWorld 旧读数24/54，两个独立官方终态评分均9/54，15次更正保留在详情中；
不把不可靠的旧读数作为成绩。受控子集和未冻结模型的限制仍然有效。

### 评测页信息组织（2026-10-22）

主视图以基准成绩、样本规模、执行条件及场景指标为核心；内部阶段编号仅保留在评测协议配置中。
同一基准存在保留样本报告时，早期单次运行收纳到“历史运行”，不合并分母。
评分修订、逐样本记录、配置版本分为独立展开区，模型快照与子集范围等必要限制保留在成绩下方。
本次仅更新界面，沿用已发布 schema v2 报告，不重新导出或改写成绩。

基准标题下的简介依据 [τ-bench 官方定义](https://github.com/sierra-research/tau-bench) 与
[AppWorld 论文](https://arxiv.org/abs/2407.18901)，数据集、领域和样本范围放入配置详情。
简介介绍基准评测目标，不扩大当前执行配置的覆盖声明。
