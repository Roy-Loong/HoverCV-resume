# 第三方组件

直接依赖（锁文件固定精确版本，完整传递依赖见 package-lock.json）：

| 组件               | 版本     | 许可证                    |
| ------------------ | -------- | ------------------------- |
| @aws-sdk/client-s3 | 3.1152.0 | Apache-2.0                |
| @floating-ui/react | 0.27.20  | MIT                       |
| better-auth        | 1.7.10   | MIT                       |
| idb                | 8.0.4    | ISC                       |
| jszip              | 3.10.2   | (MIT OR GPL-3.0-or-later) |
| lucide-react       | 1.59.0   | ISC                       |
| next               | 16.4.2   | MIT                       |
| pdf-lib            | 1.17.1   | MIT                       |
| pdfjs-dist         | 6.4.299  | Apache-2.0                |
| pg                 | 8.23.1   | MIT                       |
| react              | 19.3.1   | MIT                       |
| react-dom          | 19.3.1   | MIT                       |
| zod                | 4.6.7    | MIT                       |

PDF.js 标准字体、CMap 和 wasm 的上游许可文件随 postinstall 原样复制到 public/pdfjs。Next.js、React、PDF.js、Better Auth 当前 API 以已安装包的类型定义与 Next.js 内置官方文档核对。

设计参考的 MIT 全文见 DESIGN_REFERENCE_LICENSE.txt；PDF.js 的 Apache-2.0 全文见 PDFJS_LICENSE.txt。

测试视频由 FFmpeg 的 color 与 sine 输入在本项目内生成，为原创纯色画面与合成音；示例 PDF 使用 pdf-lib 内置标准字体生成，示例图由 Canvas 几何图形绘制，无外部照片。
