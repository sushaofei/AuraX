# Runtime 预算治理 #101

- [x] TaskView兼容可选runtime_budget，公开模型轮次/工具尝试/实际dispatch/已用与预留输出。
- [x] SDK createTask/requestRun支持显式有界readRefresh；UI不自行生成授权或轮询计时器。
- [x] 旧后端缺少用量时隐藏；原错误原因继续使用结构化details。
- [x] 类型检查、SDK55测试、2项Playwright回归及截图检查；lint无错误（5项既有Hook警告）。
- [x] 9a6500f Web构建发布至测试1420，index-eiDtxA0F.js资源与后端ready检查通过。

后端设计：https://github.com/sushaofei/AuraClaw/issues/101
