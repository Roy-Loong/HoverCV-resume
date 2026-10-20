import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "HoverCV · 让简历，多一点故事",
  description: "保留你的简历，展开你的故事。PDF 交互简历编辑器。",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
