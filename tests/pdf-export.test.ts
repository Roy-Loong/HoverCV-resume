import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { buildInteractivePdf, pdfLines, pdfText } from "../lib/pdf-export";
import { bytesToData, newAnnotation, type Project } from "../lib/schema";

async function fixture(): Promise<Project> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([595, 842]).drawText("Original vector resume", {
    x: 38,
    y: 700,
    font,
  });
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    name: "测试简历",
    pdfName: "resume.pdf",
    pdfData: bytesToData(await doc.save(), "application/pdf"),
    pdfHash: "a".repeat(64),
    annotations: [],
    pages: [
      {
        width: 595,
        height: 842,
        image: "data:image/png;base64,AAAA",
        view: [0, 0, 595, 842],
        rotation: 0,
      },
    ],
    updatedAt: new Date().toISOString(),
    revision: 0,
  } satisfies Project;
}
async function fontFetch() {
  const font = await readFile("public/fonts/DroidSansFallback.ttf");
  const fetcher = vi.fn().mockImplementation(async () => new Response(font));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
afterEach(() => vi.unstubAllGlobals());

describe("可下载的交互 PDF", () => {
  it("转换兼容的偏旁和爱心，换行不丢失中英文字符", () => {
    expect(pdfText("⻔⽴\t💗囍\0")).toBe("门立    ♥囍");
    const measure = { widthOfTextAtSize: (v: string) => v.length * 10 };
    expect(pdfLines("中英文ABC\n第二行", measure, 10, 30)).toEqual([
      "中英文",
      "ABC",
      "第二行",
    ]);
  });
  it("无注释时原样交付原 PDF，无需字体或网络", async () => {
    const p = await fixture();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const result = await buildInteractivePdf(p);
    expect(Buffer.from(await result.blob.arrayBuffer())).toEqual(
      Buffer.from(p.pdfData.split(",")[1], "base64"),
    );
    expect(result.blob.type).toBe("application/pdf");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("保留原始矢量正文和完整长中文内容，生成可解析的往返跳转与外部链接", async () => {
    await fontFetch();
    const p = await fixture();
    const a = newAnnotation(1, [[38, 695, 270, 725]], "原始正文", "text");
    a.title = "项目图文详情";
    a.body =
      "中文项目开始\n" +
      "这一段很长的中文说明用于核实跨页后没有丢失文字。".repeat(300) +
      "\n最终结尾💗囍";
    a.links = [{ label: "查看项目", url: "https://example.com/project" }];
    a.citations = [{ title: "资料来源", url: "https://example.com/source" }];
    p.annotations = [a];
    const before = JSON.stringify(p);
    const result = await buildInteractivePdf(p);
    expect(JSON.stringify(p)).toBe(before);
    const task = getDocument({
      data: new Uint8Array(await result.blob.arrayBuffer()),
    });
    const pdf = await task.promise;
    try {
      expect(pdf.numPages).toBeGreaterThan(4);
      let text = "",
        body = "",
        links = 0,
        external = 0;
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join("");
        text += pageText;
        if (i >= 3)
          body += content.items
            .filter(
              (item) =>
                "str" in item &&
                item.transform[5] >= 112 &&
                item.transform[5] <= 692,
            )
            .map((item) => ("str" in item ? item.str : ""))
            .join("");
        if (i === 1) expect(pageText).toContain("Original vector resume");
        for (const note of await page.getAnnotations()) {
          if (note.dest) {
            const target = await pdf.getPageIndex(note.dest[0]);
            expect(target).toBeGreaterThanOrEqual(0);
            expect(target).toBeLessThan(pdf.numPages);
            links++;
          }
          if (note.url) external++;
        }
      }
      expect(text).toContain("中文项目开始");
      expect(text).toContain("最终结尾♥囍");
      expect(body).toContain(pdfText(a.body).replace(/\n/g, ""));
      expect(links).toBeGreaterThanOrEqual(5);
      expect(external).toBe(2);
      expect(await pdf.getJSActions()).toBeNull();
    } finally {
      await task.destroy();
    }
  }, 30000);
  it("多个目录页互通，每个条目都有详情目的地", async () => {
    await fontFetch();
    const p = await fixture();
    p.annotations = Array.from({ length: 13 }, (_, i) =>
      newAnnotation(
        1,
        [[38, 100 + i * 20, 270, 115 + i * 20]],
        `项目 ${i + 1}`,
        "area",
      ),
    );
    const result = await buildInteractivePdf(p);
    const task = getDocument({
      data: new Uint8Array(await result.blob.arrayBuffer()),
    });
    const pdf = await task.promise;
    try {
      expect(pdf.numPages).toBe(16);
      const first = await (await pdf.getPage(2)).getAnnotations();
      const second = await (await pdf.getPage(3)).getAnnotations();
      expect(first.filter((n) => n.dest)).toHaveLength(14);
      expect(second.filter((n) => n.dest)).toHaveLength(3);
    } finally {
      await task.destroy();
    }
  });
  it("字体加载失败可重试，视频和不支持的字符明确报错而非遗漏", async () => {
    const p = await fixture();
    const a = newAnnotation(1, [[38, 695, 270, 725]], "项目", "text");
    p.annotations = [a];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    );
    await expect(buildInteractivePdf(p)).rejects.toThrow("字体下载失败");
    await fontFetch();
    a.body = "不能静默丢失🦄";
    await expect(buildInteractivePdf(p)).rejects.toThrow("🦄");
    a.media = [
      {
        id: "video",
        type: "video",
        src: "data:video/mp4;base64,AAAA",
        caption: "视频",
      },
    ];
    await expect(buildInteractivePdf(p)).rejects.toThrow("含视频");
  });
  it("取消生成后不会继续处理", async () => {
    const p = await fixture();
    const abort = new AbortController();
    abort.abort();
    await expect(
      buildInteractivePdf(p, undefined, abort.signal),
    ).rejects.toThrow();
  });
});
