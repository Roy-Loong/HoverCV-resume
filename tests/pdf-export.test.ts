import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PDFDocument,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFString,
  PDFRawStream,
  decodePDFRawStream,
  StandardFonts,
} from "pdf-lib";
import {
  HOVER_CARD_WIDTH,
  HOVER_CARD_HEIGHT,
  CSS_PIXEL_IN_PDF_POINTS,
} from "../lib/card-layout";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  buildInteractivePdf,
  pdfCardAnchors,
  pdfLines,
  pdfText,
  pdfPointerBridge,
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
vi.mock("../lib/pdf-card-render", () => ({
  renderPdfCards: vi.fn(
    async (a: {
      title: string;
      body: string;
      links: { label: string; url: string }[];
      citations: { title: string; url: string }[];
    }) => {
      const text = `${a.title}\n${a.body}`;
      return Array.from(
        { length: Math.max(1, Math.ceil(a.body.length / 300)) },
        (_, index) => ({
          png: new Uint8Array(
            Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1cAAAAASUVORK5CYII=",
              "base64",
            ),
          ),
          text,
          controls: [
            ...(index === 0
              ? [
                  ...a.links,
                  ...a.citations.map((c) => ({ label: c.title, url: c.url })),
                ].map((l, i) => ({
                  rect: [22, 150 + i * 20, 330, 166 + i * 20],
                  action: "link",
                  label: l.label,
                  url: l.url,
                }))
              : []),
          ],
        }),
      );
    },
  ),
}));
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
  it("过渡区仅连接文字与卡片，左右/上下均不覆盖卡片侧面的大片空白", () => {
    expect(pdfPointerBridge([20, 690, 80, 710], [86, 399, 356, 714])).toEqual([
      80, 687, 86, 713,
    ]);
    expect(
      pdfPointerBridge([500, 690, 550, 710], [224, 399, 494, 714]),
    ).toEqual([494, 687, 500, 713]);
    expect(pdfPointerBridge([30, 690, 570, 710], [317, 369, 587, 684])).toEqual(
      [314, 684, 573, 690],
    );
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
    // The appearance is the shared web card image; its accessible field
    // description retains full text independently of visual pagination.
    for (const f of panels) {
      const label = f.acroField.dict.get(
        PDFName.of("TU"),
      ) as import("pdf-lib").PDFHexString;
      expect(label.decodeText()).toContain(a.body);
    }
    const task = getDocument({
      data: new Uint8Array(await result.blob.arrayBuffer()),
    });
    const pdf = await task.promise;
    try {
      const source = await (await pdf.getPage(1)).getTextContent();
      expect(source.items.map((x) => ("str" in x ? x.str : "")).join("")).toBe(
        "Original vector resume",
      );
      const actions = [...((await pdf.getJSActions())?.values() || [])]
        .flat()
        .join("");
      expect(actions).toContain("app.setTimeOut(script,250)");
      expect(actions).toContain("app.setInterval(script,250)");
    } finally {
      await task.destroy();
    }
  }, 30000);
  it("多注释共用原页、不增加关闭按钮，切换标注隐藏其它卡片", async () => {
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
      0,
    );
    for (const f of fields.filter((f) => f.getName().includes("_panel_")))
      expect(
        f.acroField.dict.lookup(PDFName.of("Ff"), PDFNumber).asNumber() & 1,
      ).toBe(0);
    const annotations = doc.getPage(0).node.Annots()!;
    const names = Array.from({ length: annotations.size() }, (_, i) =>
      (
        annotations.lookup(i, PDFDict).get(PDFName.of("T")) as
          PDFString | undefined
      )?.decodeText(),
    ).filter((n): n is string => !!n);
    expect(names.slice(0, 13).every((n) => n.includes("_hover_"))).toBe(true);
    expect(names.filter((n) => n.includes("_panel_"))).toHaveLength(26);
    for (const f of fields.filter((f) => f.getName().includes("_hover_"))) {
      const action = f.acroField.dict
        .lookup(PDFName.of("AA"), PDFDict)
        .lookup(PDFName.of("E"), PDFDict);
      expect(action.get(PDFName.of("T"))?.toString().split("HC").length).toBe(
        fields.filter((f) => !f.getName().includes("_hover_")).length + 1,
      );
      // A pinned card must suppress every other source word underneath it.
      const suppress = f.acroField.dict
        .lookup(PDFName.of("A"), PDFDict)
        .lookup(PDFName.of("Next"), PDFDict);
      expect(suppress.get(PDFName.of("H"))?.toString()).toBe("true");
      const targets = suppress.get(PDFName.of("T"))!.toString();
      for (const other of fields.filter((x) => x.getName().includes("_hover_")))
        expect(targets.includes(other.getName())).toBe(other !== f);
    }
    for (const f of fields) {
      const widget = f.acroField.dict;
      expect(widget.get(PDFName.of("Border"))?.toString()).toBe("[ 0 0 0 ]");
      expect(
        widget
          .lookup(PDFName.of("BS"), PDFDict)
          .lookup(PDFName.of("W"), PDFNumber)
          .asNumber(),
      ).toBe(0);
      const mk = widget.lookup(PDFName.of("MK"), PDFDict);
      expect(mk.get(PDFName.of("BC"))?.toString()).toBe("[ ]");
      expect(mk.get(PDFName.of("BG"))?.toString()).toBe("[ ]");
    }
  });
  it("每个文字片段独立在右侧就近打开，卡片统一尺寸、复用图文外观离开文字不再原生立即隐藏", async () => {
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
    const rect = panels[0].acroField.getWidgets()[0].getRectangle();
    expect(rect.width / CSS_PIXEL_IN_PDF_POINTS).toBe(HOVER_CARD_WIDTH);
    expect(rect.height / CSS_PIXEL_IN_PDF_POINTS).toBe(HOVER_CARD_HEIGHT);
    expect(
      panels.map((f) => f.acroField.getWidgets()[0].getRectangle()),
    ).toEqual([
      { x: 156, y: 399, width: 270, height: 315 },
      { x: 181, y: 129, width: 270, height: 315 },
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
      expect(exit.lookup(PDFName.of("S"), PDFName).asString()).toBe(
        "/JavaScript",
      );
      expect(exit.get(PDFName.of("H"))).toBeUndefined();
      expect(hit.acroField.dict.get(PDFName.of("A"))?.toString()).not.toBe(
        actions.get(PDFName.of("E"))?.toString(),
      );
    }
    for (const panel of panels) {
      const actions = panel.acroField.dict.lookup(PDFName.of("AA"), PDFDict);
      // Some readers target the visual panel rather than transparent keepers.
      expect(
        actions
          .lookup(PDFName.of("E"), PDFDict)
          .get(PDFName.of("S"))
          ?.toString(),
      ).toBe("/Hide");
    }
    for (const guard of fields.filter((f) => f.getName().includes("_exit_"))) {
      expect(
        guard.acroField.dict.lookup(PDFName.of("Ff"), PDFNumber).asNumber() & 1,
      ).toBe(0);
      const group = guard.getName().split("_")[1];
      const area = guard.acroField.getWidgets()[0].getRectangle();
      for (const target of [...hits, ...panels].filter(
        (f) => f.getName().split("_")[1] === group,
      )) {
        const r = target.acroField.getWidgets()[0].getRectangle();
        expect(
          Math.min(area.x + area.width, r.x + r.width) <=
            Math.max(area.x, r.x) ||
            Math.min(area.y + area.height, r.y + r.height) <=
              Math.max(area.y, r.y),
        ).toBe(true);
      }
      const enter = guard.acroField.dict
        .lookup(PDFName.of("AA"), PDFDict)
        .lookup(PDFName.of("E"), PDFDict);
      expect(enter.get(PDFName.of("S"))?.toString()).toBe("/Hide");
      expect(enter.get(PDFName.of("H"))?.toString()).toBe("true");
    }
  });
  it("原文件的表单字段和值仍然保留", async () => {
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
  it("卡片生成失败可重试，视频明确报错而非遗漏", async () => {
    const p = await fixture();
    const a = newAnnotation(1, [[38, 695, 270, 725]], "项目", "text");
    p.annotations = [a];
    const { renderPdfCards } = await import("../lib/pdf-card-render");
    vi.mocked(renderPdfCards).mockRejectedValueOnce(Error("注释卡片生成失败"));
    await expect(buildInteractivePdf(p)).rejects.toThrow("注释卡片生成失败");
    expect((await buildInteractivePdf(p)).pages).toBe(1);
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
