# 给朋友一个网页链接

朋友的使用方式：**打开网址 → 上传 PDF → 选择文字或框选 → 编辑卡片 → 导出**。无需安装 Node.js，无需注册 HoverCV 账户。PDF、标注和素材在朋友自己的浏览器里处理、保存；不会自动发送给网站服务器或出现在其他人的浏览器里。

网页部署配置已经放在仓库中。首次上线需要仓库所有者在自己的 Vercel 账户内完成 GitHub 授权；部署者需要登录，朋友不需要。

## 首次上线，只操作一次

1. 打开 **[Vercel 新建项目](https://vercel.com/new)**，用 **Continue with GitHub** 登录。按页面要求完成账户创建。
2. 在 **Import Git Repository** 中找到 **Roy-Loong/HoverCV-resume**，点 **Import**。如果列表中没有它，通过页面的 GitHub 授权入口允许 Vercel 读取这个仓库，再返回导入。
3. 项目名可以用 `hovercv` 或自己喜欢的名称。框架保留 **Next.js**，根目录保留仓库根目录。仓库已声明 Node.js **24.x**，构建和安装命令会从 `vercel.json` 自动读取；**无需填写环境变量，也不用上传 PDF 或 `.env.local`**。点击 **Deploy**。
4. 等页面显示 **Ready** 后，打开项目的 **Domains**，复制生产环境网址。在浏览器无痕窗口打开，确认无需登录即可使用，再把这个网址发给朋友。如果出现 Vercel 登录页，在项目 **Settings → Deployment Protection** 中将生产环境访问设为公开。

现有生产网址：**https://hover-cv-resume.vercel.app/**。后续继续分享这个网址，朋友无需下载源码。

## 后续更新

保持 Vercel 连接原仓库 `Roy-Loong/HoverCV-resume`，生产分支选择 `main`。后续向这个分支推送修改，Vercel 会自动重新构建；朋友继续使用同一个生产环境网址。无需重新下载项目。

网页版以 `npm run build:web` 构建，隐藏未启用的作者登录、云发布和 AI 入口。PDF 上传、高清预览、选词/框选、悬浮卡片、撤销重做、画布拖动缩放、面板调整、素材导入和四种导出保留。原来的本机启动与完整服务部署仍使用 `npm run build`。

## 朋友完成后导出什么

| 导出项         | 用途                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------- |
| 悬浮交互 PDF   | 生成后点“下载悬浮交互 PDF”；保留原页数，支持交互的阅读器中悬停或点击查看图文、翻图与关闭 |
| 独立 HTML      | 交给别人阅读，保留悬浮卡片和素材                                                         |
| 离线阅读 ZIP   | 素材较多时使用；解压后打开 `index.html`                                                  |
| 可编辑项目 ZIP | 备份、转移到另一台电脑或浏览器，之后点“恢复项目 ZIP”继续编辑                             |

PDF 在浏览器内生成并直接下载，保留原简历页数，图文保存在隐藏的 PDF 表单卡片中，通过鼠标进入事件展开。可通过微信发送文件；接收者需要支持表单交互的阅读器，例如支持这些事件的 WPS / Acrobat 桌面版。微信内置预览、手机端和浏览器预览不保证执行这些交互，不能保证“微信内直接打开即可悬浮”。不支持交互时仍能阅读原简历。支持 PDF JavaScript 计时器时移开约 150 ms 关闭，不支持时直接关闭；单击文字可固定卡片，再翻图或点 × 关闭。卡片统一尺寸，每段文字就近定位，优先右侧、页边在原页内避让。视频和网页悬浮可继续使用 HTML / 离线 ZIP。每个人的自动保存只属于当前浏览器、当前网站地址；清除浏览器数据前请导出项目 ZIP。

手机建议 **PDF + 只读网页链接**。在导出面板新增“手机阅读链接”，需网站所有者一次性连接 Vercel Blob、设置发布口令后启用。开通步骤及验证范围见 **[手机阅读指引](docs/MOBILE_READING_ZH.md)**。只有主动点击生成阅读链接时才上传加密图文，普通编辑与导出仍在浏览器内完成。

## 维护者验证

```bash
npm ci
npm run build:web
# 在没有 VERCEL 环境标记的本机，以上命令也会生成可启动的 standalone 目录。
npm start
```

用运行机器的浏览器打开应用，验证上传 PDF、添加注释、阅读预览、导出四种格式，以及项目 ZIP 重新导入。专门的网页模式端到端检查：

```bash
HOVERCV_TEST_BROWSER_ONLY=1 npm run test:e2e -- tests/e2e/web.spec.ts tests/e2e/pdf.spec.ts tests/e2e/mobile.spec.ts
```

服务器可通过 `HOVERCV_TEST_BASE_URL` 指向测试环境；Playwright 的 Chromium 路径按本机配置。该测试不需要数据库、作者账户或 AI 密钥，也不使用真实个人简历。

代码中的部署配置和本地验证不等于 Vercel 已上线；以 Vercel 的实际部署结果和生产网址测试为准。

PDF 原生交互验证（维护者，可选安装 Python 的 `pypdfium2` 和 `pypdf`）：先运行上述 PDF 浏览器测试，再运行 `python scripts/verify-pdf-hover.py /tmp/hovercv-pdf-test/download.pdf`。该检查实际发送鼠标进入、翻图和关闭事件；PDFium 的通过结果不等于微信或所有 WPS / Acrobat 版本已验证。
