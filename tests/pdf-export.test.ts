import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import {
  PDFDocument,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFString,
  PDFRawStream,
  StandardFonts,
} from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  buildInteractivePdf,
  pdfCardAnchors,
  pdfLines,
  pdfText,
} from "../lib/pdf-export";
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
vi.mock("../lib/pdf-anchor-images", () => ({
  pdfAnchorImages: vi.fn().mockResolvedValue([]),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

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
  it("同一行相邻汉字和重叠偏旁共用触发区，跨行或远距离文字仍各自就近定位", () => {
    expect(
      pdfCardAnchors([
        [20, 100, 50, 114],
        [49, 100, 55, 114],
        [52, 98, 65, 116],
        [64, 98, 70, 116],
        [20, 60, 60, 74],
        [200, 100, 240, 114],
      ]),
    ).toEqual([
      [20, 98, 70, 116],
      [20, 60, 60, 74],
      [200, 100, 240, 114],
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
  it("原页数和正文不变，长说明保留在隐藏卡片内，悬停、点击和外部链接均有效", async () => {
    await fontFetch();
    const p = await fixture(),
      a = newAnnotation(1, [[38, 695, 270, 725]], "原始正文", "text");
    a.title = "项目图文详情";
    a.body =
      "中文项目开始\n" +
      "这一段很长的中文说明用于核实卡片翻页后没有丢失文字。".repeat(200) +
      "\n最终结尾💗囍";
    a.links = [{ label: "查看项目", url: "https://example.com/project" }];
    a.citations = [{ title: "资料来源", url: "https://example.com/source" }];
    p.annotations = [a];
    const before = JSON.stringify(p),
      result = await buildInteractivePdf(p);
    expect(JSON.stringify(p)).toBe(before);
    expect(result.pages).toBe(1);
    const doc = await PDFDocument.load(await result.blob.arrayBuffer());
    expect(doc.getPageCount()).toBe(1);
    const fields = doc.getForm().getFields(),
      hover = fields.find((f) => f.getName().includes("_hover_"))!.acroField
        .dict;
    const enter = hover
      .lookup(PDFName.of("AA"), PDFDict)
      .lookup(PDFName.of("E"), PDFDict);
    expect(enter.lookup(PDFName.of("S"), PDFName).asString()).toBe("/Hide");
    expect(hover.get(PDFName.of("A"))).toBeDefined();
    expect(hover.get(PDFName.of("Rect"))?.toString()).toBe(
      "[ 37 694 271 726 ]",
    );
    const panels = fields.filter((f) => f.getName().includes("_h_panel_"));
    expect(panels.length).toBeGreaterThan(5);
    const uriFields = fields.filter((f) => f.getName().includes("_link_"));
    expect(uriFields).toHaveLength(4);
    expect(
      uriFields[0].acroField.dict
        .lookup(PDFName.of("A"), PDFDict)
        .lookup(PDFName.of("URI"), PDFString)
        .decodeText(),
    ).toBe("https://example.com/project");
    for (const f of fields.filter((f) => !f.getName().includes("_hover_")))
      expect(
        f.acroField.dict.lookup(PDFName.of("F"), PDFNumber).asNumber(),
      ).toBe(2);
    // Inspect appearance streams through PDF.js as temporary test pages. These
    // pages are never part of the exported file.
    for (const f of panels) {
      const appearance = f.acroField.dict.lookup(PDFName.of("AP"), PDFDict),
        ref = appearance.get(PDFName.of("N"))!;
      const stream = doc.context.lookup(ref),
        page = doc.addPage([260, 360]);
      if (!(stream instanceof PDFRawStream))
        throw Error("Missing appearance stream");
      page.node.set(
        PDFName.of("Resources"),
        stream.dict.get(PDFName.of("Resources"))!,
      );
      page.node.set(PDFName.of("Contents"), ref);
    }
    const task = getDocument({
        data: await doc.save({ updateFieldAppearances: false }),
      }),
      pdf = await task.promise;
    try {
      const source = await (await pdf.getPage(1)).getTextContent();
      expect(source.items.map((x) => ("str" in x ? x.str : "")).join("")).toBe(
        "Original vector resume",
      );
      let text = "";
      for (let i = 2; i <= pdf.numPages; i++) {
        const content = await (await pdf.getPage(i)).getTextContent();
        text += content.items
          .filter(
            (x) => "str" in x && x.transform[5] > 47 && x.transform[5] < 310,
          )
          .map((x) => ("str" in x ? x.str : ""))
          .join("");
      }
      expect(text.includes(pdfText(a.body).replace(/\n/g, ""))).toBe(true);
      expect(
        [...((await pdf.getJSActions())?.values() || [])].flat().join(""),
      ).toContain('setTimeOut("HC_hide();",150)');
    } finally {
      await task.destroy();
    }
  }, 30000);
  it("多注释共用原页，不生成跳页；切换标注隐藏其它卡片且关闭按钮位于卡片上层", async () => {
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
    const result = await buildInteractivePdf(p),
      doc = await PDFDocument.load(await result.blob.arrayBuffer());
    expect(doc.getPageCount()).toBe(1);
    const fields = doc.getForm().getFields();
    expect(fields.filter((f) => f.getName().endsWith("_close"))).toHaveLength(
      26,
    );
    for (const f of fields.filter((f) => f.getName().includes("_panel_")))
      expect(
        f.acroField.dict.lookup(PDFName.of("Ff"), PDFNumber).asNumber() & 1,
      ).toBe(1);
    const annotations = doc.getPage(0).node.Annots()!;
    const names = Array.from({ length: annotations.size() }, (_, i) =>
      annotations
        .lookup(i, PDFDict)
        .lookup(PDFName.of("T"), PDFString)
        .decodeText(),
    );
    expect(names.slice(0, 13).every((n) => n.includes("_hover_"))).toBe(true);
    expect(names.slice(13, 39).every((n) => n.includes("_panel_"))).toBe(true);
    expect(
      names
        .slice(39)
        .every((n) => n.endsWith("_close") || n.includes("_keep_")),
    ).toBe(true);
    for (const f of fields.filter((f) => f.getName().includes("_hover_"))) {
      const action = f.acroField.dict
        .lookup(PDFName.of("AA"), PDFDict)
        .lookup(PDFName.of("E"), PDFDict);
      expect(action.get(PDFName.of("T"))?.toString().split("HC").length).toBe(
        fields.filter((f) => !f.getName().includes("_hover_")).length + 1,
      );
    }
    const controls = fields.filter((f) => f.getName().endsWith("_close"));
    for (const f of fields.filter((f) => f.getName().includes("_keep_"))) {
      const area = f.acroField.getWidgets()[0].getRectangle();
      for (const c of controls.filter(
        (c) => c.getName().split("_")[1] === f.getName().split("_")[1],
      )) {
        const button = c.acroField.getWidgets()[0].getRectangle();
        expect(
          Math.min(area.x + area.width, button.x + button.width) <=
            Math.max(area.x, button.x) ||
            Math.min(area.y + area.height, button.y + button.height) <=
              Math.max(area.y, button.y),
        ).toBe(true);
      }
    }
  });
  it("每个文字片段独立在右侧就近打开，卡片统一尺寸、复用图文外观并具备原生退出动作", async () => {
    await fontFetch();
    const p = await fixture();
    p.annotations = [
      newAnnotation(
        1,
        [
          [30, 690, 150, 710],
          [45, 420, 175, 440],
        ],
        "分段标注",
        "text",
      ),
    ];
    const result = await buildInteractivePdf(p),
      doc = await PDFDocument.load(await result.blob.arrayBuffer());
    const fields = doc.getForm().getFields(),
      hits = fields.filter((f) => f.getName().includes("_hover_")),
      panels = fields.filter((f) => f.getName().includes("_h_panel_"));
    expect(hits).toHaveLength(2);
    expect(panels).toHaveLength(2);
    expect(
      panels.map((f) => f.acroField.getWidgets()[0].getRectangle()),
    ).toEqual([
      { x: 156, y: 354, width: 260, height: 360 },
      { x: 181, y: 84, width: 260, height: 360 },
    ]);
    expect(
      panels[0].acroField.dict
        .lookup(PDFName.of("AP"), PDFDict)
        .get(PDFName.of("N"))
        ?.toString(),
    ).toBe(
      panels[1].acroField.dict
        .lookup(PDFName.of("AP"), PDFDict)
        .get(PDFName.of("N"))
        ?.toString(),
    );
    for (const hit of hits) {
      const actions = hit.acroField.dict.lookup(PDFName.of("AA"), PDFDict),
        exit = actions.lookup(PDFName.of("X"), PDFDict);
      expect(exit.lookup(PDFName.of("S"), PDFName).asString()).toBe("/Hide");
      expect(exit.lookup(PDFName.of("H"))?.toString()).toBe("true");
      expect(hit.acroField.dict.get(PDFName.of("A"))?.toString()).not.toBe(
        actions.get(PDFName.of("E"))?.toString(),
      );
    }
  });
  it("原文件的表单字段和值仍然保留", async () => {
    await fontFetch();
    const p = await fixture(),
      doc = await PDFDocument.load(
        Buffer.from(p.pdfData.split(",")[1], "base64"),
      );
    const original = doc.getForm().createTextField("existing");
    original.setText("Original value");
    original.addToPage(doc.getPage(0), {
      x: 30,
      y: 30,
      width: 100,
      height: 20,
    });
    p.pdfData = bytesToData(await doc.save(), "application/pdf");
    p.annotations = [newAnnotation(1, [[38, 695, 270, 725]], "项目", "text")];
    const result = await buildInteractivePdf(p),
      saved = await PDFDocument.load(await result.blob.arrayBuffer());
    expect(saved.getForm().getTextField("existing").getText()).toBe(
      "Original value",
    );
    expect(saved.getPageCount()).toBe(1);
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
