import {
  describe,
  it,
  expect,
  vi,
  afterEach,
  beforeAll,
  afterAll,
} from "vitest";
import {
  getDocument,
  type PDFPageProxy,
  type PDFDocumentProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument } from "pdf-lib";
let pdfDoc: PDFDocumentProxy, pdfPage: PDFPageProxy;
beforeAll(async () => {
  const d = await PDFDocument.create();
  const p = d.addPage([640, 860]);
  p.setCropBox(20, 30, 600, 800);
  pdfDoc = await getDocument({ data: await d.save() }).promise;
  pdfPage = await pdfDoc.getPage(1);
});
afterAll(async () => {
  await pdfDoc?.loadingTask.destroy();
});
import { clientToPdf, pdfToPercent, coalesceRects } from "../lib/coordinates";
import { imagePercent, jsonForScript, readerHtml } from "../lib/reader";
import { newAnnotation, projectSchema, type Project } from "../lib/schema";
import { publicIpv4 } from "../lib/image-import";
import { openAICompatible } from "../lib/providers";
const project: Project = {
  schemaVersion: 1,
  id: crypto.randomUUID(),
  name: "安全测试",
  pdfName: "test.pdf",
  pdfData: "data:application/pdf;base64,JVBERi0=",
  pdfHash: "a".repeat(64),
  annotations: [],
  pages: [
    {
      width: 600,
      height: 800,
      image: "data:image/jpeg;base64,AAAA",
      view: [20, 30, 620, 830],
      rotation: 0,
    },
  ],
  updatedAt: new Date().toISOString(),
  revision: 0,
};
describe("PDF 坐标与导出方向", () => {
  for (const rotation of [0, 90, 180, 270])
    for (const scale of [0.6, 1, 1.7])
      it(`CropBox 非零 / ${rotation}° / 缩放 ${scale}`, () => {
        const v = pdfPage.getViewport({ scale, rotation });
        const rect: [number, number, number, number] = [100, 200, 240, 260];
        const [l, t, w, h] = pdfToPercent(rect, v);
        const box = {
          left: 43,
          top: 126,
          width: v.width * 0.83,
          height: v.height * 0.83,
        };
        const r = clientToPdf(
          {
            left: box.left + (l / 100) * box.width,
            top: box.top + (t / 100) * box.height,
            right: box.left + ((l + w) / 100) * box.width,
            bottom: box.top + ((t + h) / 100) * box.height,
          },
          box,
          v,
        );
        r.forEach((n, i) => expect(n).toBeCloseTo(rect[i], 6));
        const pct = imagePercent(rect, { ...project.pages[0], rotation });
        pct.forEach((n, i) => expect(n).toBeCloseTo([l, t, w, h][i], 6));
      });
  it("DPR 不参与 CSS 坐标", () => {
    const v = pdfPage.getViewport({ scale: 1, rotation: 0 });
    const box = { left: 0, top: 0, width: 600, height: 800 };
    expect(
      clientToPdf({ left: 60, top: 80, right: 120, bottom: 160 }, box, v),
    ).toEqual([80, 670, 140, 750]);
  });
});
describe("数据与导出安全", () => {
  it("不接受未来 schemaVersion 与脚本 URL", () => {
    expect(
      projectSchema.safeParse({ ...project, schemaVersion: 2 }).success,
    ).toBe(false);
    const a = newAnnotation(1, [[20, 30, 40, 50]], "safe", "text");
    a.links = [{ label: "bad", url: "javascript:alert(1)" }];
    expect(
      projectSchema.safeParse({ ...project, annotations: [a] }).success,
    ).toBe(false);
  });
  it("拒绝无效页码和反向矩形", () => {
    const a = newAnnotation(3, [[50, 30, 20, 40]], "x", "text");
    expect(
      projectSchema.safeParse({ ...project, annotations: [a] }).success,
    ).toBe(false);
  });
  it("内嵌 JSON 不可结束 script 标签", () => {
    expect(jsonForScript("</script><script>alert(1)</script>")).not.toContain(
      "<",
    );
    const p = { ...project, name: "<script>boom</script>" };
    const html = readerHtml(p);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toMatch(/(?:localhost|blob:|pdf\.worker)/);
    expect(html).toContain("data:image/jpeg;base64,AAAA");
  });
});
describe("图片导入网络限制", () => {
  it.each([
    "127.0.0.1",
    "169.254.169.254",
    "10.0.0.1",
    "172.16.2.3",
    "192.168.1.1",
    "100.64.0.1",
    "224.0.0.1",
    "0.0.0.0",
    "198.18.0.1",
  ])("拒绝 %s", (ip) => expect(publicIpv4(ip)).toBe(false));
  it("允许普通公网地址", () => expect(publicIpv4("8.8.8.8")).toBe(true));
});
describe("AI 引用必须来自本次搜索", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it("拒绝模型编造的 URL，保留已有草稿", async () => {
    vi.stubEnv("AI_API_BASE", "https://api.openai.com/v1");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    body: "伪造",
                    citations: [
                      {
                        title: "invented",
                        url: "https://invented.example.com",
                      },
                    ],
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    await expect(
      openAICompatible.summarize(
        "词",
        "少量上下文",
        [
          {
            url: "https://example.com/source",
            title: "真实来源",
            content: "真实内容",
          },
        ],
        new AbortController().signal,
      ),
    ).rejects.toThrow("未检索到");
  });
});

describe("多行 Range 去重", () => {
  it("移除完全选中 span 的重复包围框，保留三行独立文字框", () => {
    const r = (left: number, top: number, width: number, height: number) =>
      ({
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
      }) as DOMRect;
    const input = [
      r(10, 20, 100, 13),
      r(10, 40, 120, 9),
      r(10, 38, 120, 13),
      r(10, 56, 115, 13),
      r(0, 0, 0, 19),
    ];
    const result = coalesceRects(input);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.top)).toEqual([20, 38, 56]);
  });
});
