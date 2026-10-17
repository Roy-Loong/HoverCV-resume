# 实施顺序

最初实现依据用户提供的 DEVELOPMENT_PROMPT.md。正式 PRD 后续补充为参考，原文见 PRD.md；按原始编号的验收映射见 ACCEPTANCE.md，差异见 PRD_REVIEW.md。

1. Next.js + React + TypeScript；基于 awesome-design-md 的 Notion / Linear 文档建立 DESIGN.md。
2. PDF.js 原版渲染、文字层、多矩形锚点、区域选择、三种卡片、图片视频链接、IndexedDB 自动保存。
3. 共享静态阅读器：公开快照、预览、独立 HTML、离线 ZIP；项目 ZIP 还原。
4. Better Auth + PostgreSQL 作者账户、revision 并发控制、MinIO 私有资源、不可变发布及撤回。
5. Tavily + 可替换模型接口，来源白名单验证、超时取消、账户限额、人工采纳。
6. 类型检查、单元测试、浏览器真实交互和匿名读取、独立导出验证、部署与环境启动配置。
