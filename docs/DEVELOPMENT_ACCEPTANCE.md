> 历史验收记录：以下 AC 编号是收到正式 PRD 前的临时编号。当前正式映射请看 [ACCEPTANCE.md](ACCEPTANCE.md)。本文件保留原有证据，不作为正式 PRD 全部通过的声明。

# HoverCV 验收记录

需求依据：用户附件 DEVELOPMENT_PROMPT.md。用户确认无需另附 PRD。AC01–AC20 为本次整理的映射。

“通过”仅指下列实际验证范围；外部服务、真机与未运行的部署方式单独列明。

| 编号 | 验收内容                                 | 实现位置                              | 验证与结论                                                                                                                                       |
| ---- | ---------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC01 | 上传真实 PDF，保留排版与文字层           | PdfViewer / Editor                    | 浏览器实际上传 public/demo.pdf，Canvas 与文字层工作；通过                                                                                        |
| AC02 | 单处、多行、同名词独立坐标，跨页提示     | PdfViewer.selection                   | 多行真实鼠标选择、逐行矩形、编辑恢复通过；同名词按本次 Range 独立绑定，跨页由代码拒绝；跨页真实浏览器用例未覆盖                                  |
| AC03 | 框选区域与创建/编辑/删除/重新定位        | PdfViewer / Editor                    | 浏览器框选与重新定位保留内容通过；删除实现和媒体删除测试见 editor.spec                                                                           |
| AC04 | 文档 SHA、CropBox、旋转、CSS 缩放、DPR   | coordinates / schema                  | PDF.js 真实 PageViewport，4 方向×3 缩放、非零 CropBox、DPR 分离与重复框去重；单元测试通过                                                        |
| AC05 | 四色、自定义色、提取主题色               | Editor style tab                      | 四色/自定义/提取功能已实现，浏览器验证代表颜色与样式切换；主题色候选未专门自动验证                                                               |
| AC06 | 悬停延迟、安全通道、单卡、Esc            | Hotspot / reader                      | 真实斜向移动、间隙、快速切换、关闭；180/250ms 浏览器时钟测试通过                                                                                 |
| AC07 | 三模板统一尺寸、内部滚动、手机底层       | Hotspot / reader / CSS                | 模板切换、360×420、内部滚动、390px 触屏底部浮层；通过。微信真机未测试                                                                            |
| AC08 | 图片组、说明、排序、替换、上传进度       | Editor / export                       | 翻图、导入/排序/替换/说明测试；本地素材限制和进度已实现                                                                                          |
| AC09 | 3.5 秒轮播、操作暂停、计时清理           | Hotspot / reader                      | 编辑器 3.5秒/控件暂停/重新打开从首张开始的浏览器时钟测试通过；离线轮播实现未做同等时钟测试                                                       |
| AC10 | 视频无自动发声，关闭暂停，全屏保护       | Hotspot / reader                      | 浏览器播放带合成音视频，关闭后原视频元素 paused=true；通过。系统原生全屏退出未测试                                                               |
| AC11 | 本地自动保存/恢复，无需登录              | local / Editor                        | IndexedDB 保存、刷新恢复、多行说明不丢；通过                                                                                                     |
| AC12 | 真实搜索与模型、最少上下文、人工确认     | providers / api/ai / Editor           | 真实服务适配器与确认流程已实现，缺密钥显示未配置；未配置真实 AI/Tavily 密钥，联网生成未验证                                                      |
| AC13 | 真实来源与检索时间、不编造 URL           | providers / core.test                 | mock 仅用于测试非法来源被拒绝，产品无 mock；单元测试通过；真实来源生成待密钥验证                                                                 |
| AC14 | 图片候选、人工导入、来源、安全限制       | api/images / image-import             | 来源候选/用户导入接口已实现，私网 IP 拒绝测试通过；真实搜索图片导入未验证                                                                        |
| AC15 | 作者账户、所有权、CSRF、配额             | server / auth / projects              | 真实 Better Auth 注册、另一账户无权读写、匿名无权取草稿；通过。邮件验证/密码找回未配置                                                           |
| AC16 | revision 冲突 409、云草稿恢复            | api/projects                          | 真实 PostgreSQL + 私有本地目录保存、旧 revision 返回409；通过。MinIO/S3 后端集成未验证                                                           |
| AC17 | 不可变快照、匿名读取、媒体访问、撤回     | publish / read / reader               | 新的无 Cookie 浏览器读取页面/图片/翻图；改草稿不变更旧快照，撤回404；通过。尚无真实外网域名                                                      |
| AC18 | 独立 HTML / 离线 ZIP，无 worker/临时地址 | export / reader                       | HTML 断网独立文档实际显示/悬停/翻图、无 blob/localhost/worker 引用；通过此范围。file:// 被浏览器策略阻止，磁盘双击打开未验证；ZIP 生成实现已提供 |
| AC19 | 可编辑项目 ZIP、schemaVersion、PDF 校验  | export / schema                       | 实际下载 ZIP，检查原PDF与版本、重新导入成功；schemaVersion 拒绝与哈希校验已实现；通过                                                            |
| AC20 | 构建、类型、文档、部署、许可证           | scripts / docs / Dockerfile / compose | 类型检查、生产构建、单元及端到端测试通过；MIT/NOTICE/配置/备份文档已提供。Docker/MinIO 构建受下载限制，未完成该部署实测                          |

## 当前环境与外部条件

- Node.js 24.19.0、锁定 npm 依赖、Next.js 16.4.2、PDF.js 6.4.299。使用系统 Chromium 进行真实浏览器测试。
- 当前作者服务使用本机 PostgreSQL + `.data/private` 私有目录；本地编辑、单机作者服务、匿名快照和导出可用。
- MinIO 官方镜像访问被拒绝；官方源码构建所需 `storage.googleapis.com` 下载返回 403。没有关闭 TLS、校验和或 Go 模块验证。已把所需域名加入环境配置草稿，保存草稿不会立即应用或发布网络策略。
- AI 尚无 AI_API_KEY / TAVILY_API_KEY，未执行真实模型或搜索调用，也未把 mock 作为产品结果。
- 无真实微信设备、外网 HTTPS 域名、邮件服务；这些验证尚未执行。
- 当前环境启动/安装脚本可复用，但没有验证发布后在新任务恢复。没有推送 GitHub，没有公开部署。

## 测试命令

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

核心单元测试：tests/core.test.ts。浏览器测试：tests/e2e/editor.spec.ts 与 cloud.spec.ts。

## 已完成的验证结果

- `npm run typecheck`：通过。
- `npm test`：28 项通过，0 失败。
- `npm run build`：通过，含 standalone 静态资源准备。
- 浏览器完整流程：8 项通过，0 失败（系统 Chromium，包含无账户阅读上下文）。
- 实际运行完整保存的安装脚本：npm ci → 本地服务/迁移 → 类型检查 → 构建 → 备份，退出码 0。
- 后端密钥未出现在浏览器静态 JavaScript 的检查：通过。

当前环境运行能力和草稿保存已有证据；这不代表已发布快照、已推送 GitHub 或已在新任务验证恢复。

## 本机测试包补充验证

新增 Windows `.bat` 与 macOS `.command` 入口，共用 Node 启动程序：自动安装锁定依赖、检查端口、复用已运行的 HoverCV、就绪后尝试打开浏览器。全新解压目录中实际完成安装与启动，未提供数据库、Docker 或密钥，实际验证 PDF 上传、框选编辑、刷新恢复和 HTML 导出。

复测发现并修复了“重新上传相同 PDF 后，新项目缺少页面缓存而无法自动保存”的问题：PDF 阅读器同时绑定项目 ID，上传时重置保存状态。新增浏览器回归用例，直接核对 IndexedDB 中新项目的持久数据与刷新后的说明。

- 无云服务配置的本地编辑浏览器流程：8 项通过（含新回归用例）。
- 类型检查、28 项单元测试和生产构建通过。
- Windows/macOS 双击入口未在对应实体系统上测试；共用程序已在 Linux 验证。Mac 入口的 ZIP 执行权限和 Windows CRLF 换行已检查。
