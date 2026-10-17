# 架构

- `components/PdfViewer.tsx`：PDF.js 6 worker 独立部署、Canvas + 官方文字层、逐行 Range / 区域选择。文本保持浏览器原生选择；未启用 PDF 脚本执行，也没有渲染 PDF 内的可执行表单或注释脚本。
- `lib/coordinates.ts`：CSS 位置经 PageViewport 转换回原生 PDF 坐标，去除 Range 中元素/文本重复包围框；锚点与文档 SHA-256、页码、原文/上下文绑定。
- `components/Hotspot.tsx`：Floating UI 的 offset/flip/shift/size/autoUpdate/safePolygon、180/250 ms、一次仅一卡。键盘焦点和 Escape；手机底部浮层；视频与轮播清理。
- `components/Editor.tsx`：独立编辑面板，不随阅读卡片关闭而丢失内容；导入和媒体操作，人工采纳 AI 草稿。
- `lib/schema.ts`：Zod 版本化项目格式。内嵌素材限为特定图片/视频 MIME；链接仅 http(s)。
- `lib/local.ts`：IndexedDB 自动保存；localStorage 仅存最近项目 ID。
- `lib/pdf-render.ts`：按设备像素比绘制原 PDF，文字标注通过 PDF 原字形着色，裁剪合成时保留背景与图像；内存与尺寸上限防止超大 Canvas。`PdfViewer` 为阅读器生成 3 倍分辨率无损 PNG，旧项目打开时也会重新生成。
- `lib/reader.ts`：作者预览、匿名快照、离线导出共用同一独立阅读器。使用已着色的 PNG 和透明热点，相对坐标适配缩放。无 worker、外链字体或实时 AI 请求。独立脚本也包含延迟和三角形安全通道。
- `lib/edit-history.ts`：不复制 PDF 与页面图像的 50 步会话编辑历史，合并连续输入，支持删除撤销；切换项目或刷新不跨项目恢复历史。
- `scripts/windows-update.ps1`：Windows 本机自动更新到独立目录、预安装、替换可识别的 HoverCV 进程树，固定本机端口并生成桌面快捷方式。不会删除旧目录。
- `lib/export.ts`：HTML/离线 ZIP；可编辑项目 ZIP 包含原 PDF、注释 JSON、媒体；有版本和 PDF 哈希校验。项目 JSON 为可独立恢复的清单，素材另存的条目便于取回。
- `lib/server.ts`：Better Auth + PostgreSQL、SameSite/HttpOnly Cookie、Origin 写入校验、请求大小限制、服务端用户身份、限额。
- `app/api/projects`：事务锁和 revision 乐观并发控制，409 不中断本地编辑；不接受客户端 ownerId。
- `lib/storage.ts`：私有存储适配器，S3/MinIO 或单机目录。草稿和快照只在服务端访问，不向客户端暴露桶凭证或任意对象键。
- `app/api/publish`：只发布作者当前 revision，独立不可变对象；撤回使路由失效并删除对象。
- `app/api/read`：匿名只读特定公开快照；无作者认证中间件；no-store，CSP 哈希脚本、无网络连接权限、sandbox、禁止嗅探。返回的 HTML 只含该版本页面与引用的素材。
- `lib/providers.ts`：SearchProvider / ModelProvider 可替换接口，Tavily + OpenAI 兼容实现。只有关键词和确认后的最少上下文发送到模型；搜索摘录被当作数据，无工具执行能力；引用 URL 对本次结果逐字校验。
- `lib/image-import.ts`：允许站点、HTTPS、DNS 公网 IPv4 校验并固定解析地址，禁止重定向，限制响应体、类型、文件签名、超时，避免内网代理与 DNS 重绑定。

数据保留：本地项目属于当前浏览器；服务器私有存储持久保留，需主动备份。发布不会更新旧链接；撤回后只清理发布版本，作者仍保有草稿。草稿每次保存替换对象并删除旧对象；清理脚本重试已撤回对象，清理旧额度记录。

已知工程取舍：首版将整个项目的私有 JSON 作为一个对象保存，页面与素材用 data URI，便于原子保存和离线阅读，代价是大文件内存占用和重复数据。采用 60 MB 项目上限，后续可拆成内容寻址的独立对象；当前不做实时协同编辑或 OCR。公共服务邮件发送、域名、HTTPS 与远端服务实测需要部署者配置。
