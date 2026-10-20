import {
  BlendMode,
  PDFDocument,
  PDFName,
  PDFString,
  clip,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import {
  dataToBytes,
  projectSchema,
  type Annotation,
  type Media,
  type Project,
} from "./schema";
import { imageLayout } from "./media-layout";

export type PdfProgress = (message: string) => void;
const WIDTH = 595,
  HEIGHT = 842,
  MARGIN = 38;
const ACCENT = "#6099a9",
  INK = "#253346",
  MUTED = "#70818e";
const color = (hex: string) =>
  rgb(
    ...([1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
      number,
      number,
      number,
    ]),
  );

export function pdfText(value: string) {
  return Array.from(value, (c) => {
    const cp = c.codePointAt(0)!;
    if (c === "⻔") return "门";
    if (cp >= 0x2e80 && cp <= 0x2fdf) return c.normalize("NFKC");
    if ((cp >= 0x1f493 && cp <= 0x1f49f) || c === "❤") return "♥";
    if (c === "\t") return "    ";
    return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufe0f]/.test(c) ? "" : c;
  }).join("");
}

export function pdfLines(
  text: string,
  font: Pick<PDFFont, "widthOfTextAtSize">,
  size: number,
  width: number,
) {
  const lines: string[] = [];
  for (const paragraph of pdfText(text).replace(/\r\n?/g, "\n").split("\n")) {
    let line = "";
    for (const char of paragraph) {
      if (line && font.widthOfTextAtSize(line + char, size) > width) {
        lines.push(line);
        line = "";
      }
      line += char;
    }
    lines.push(line);
  }
  return lines;
}

async function photoBytes(media: Media, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(Error("有图片无法读取，请替换该图片后重试。"));
    img.src = media.src;
  });
  signal?.throwIfAborted();
  const scale = Math.min(
    1,
    4096 / Math.max(img.naturalWidth, img.naturalHeight),
    Math.sqrt(12_000_000 / (img.naturalWidth * img.naturalHeight)),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#f0eaf6";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  try {
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(Error("图片处理失败"))),
        "image/jpeg",
        0.96,
      ),
    );
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    img.src = "";
  }
}

/** Generates a self-contained PDF locally. No PDF, notes or media are uploaded. */
export async function buildInteractivePdf(
  input: Project,
  progress: PdfProgress = () => {},
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const p = projectSchema.parse(input);
  if (p.annotations.some((a) => a.media.some((m) => m.type === "video")))
    throw Error(
      "当前 PDF 版支持文字和静态图片。项目含视频，请使用 HTML 或离线 ZIP 保留视频；原内容未改动。",
    );
  if (!p.annotations.length)
    return {
      blob: new Blob([dataToBytes(p.pdfData)], { type: "application/pdf" }),
      filename: `${p.name}_交互.pdf`,
      pages: p.pages.length,
    };
  progress("正在准备 PDF 中文字体…");
  const [fontResponse, { default: fontkit }] = await Promise.all([
    fetch("/fonts/DroidSansFallback.ttf", { signal }),
    import("@pdf-lib/fontkit"),
  ]);
  if (!fontResponse.ok) throw Error("PDF 字体下载失败，请检查网络后重试。");
  const doc = await PDFDocument.load(dataToBytes(p.pdfData));
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await fontResponse.arrayBuffer(), {
    // Subsetting this CJK font can retain extractable text but drop visible
    // glyphs in readers. Embed the complete font for reliable rendering.
    subset: false,
  });
  const supported = new Set(font.getCharacterSet());
  const allText = pdfText(
    p.name +
      p.annotations
        .map(
          (a) =>
            a.title +
            a.body +
            a.links.map((l) => l.label || l.url).join("") +
            a.citations.map((c) => c.title).join("") +
            a.media.map((m) => m.caption).join(""),
        )
        .join(""),
  );
  for (const c of allText) {
    if (
      c !== "\n" &&
      c !== "\r" &&
      c !== "\t" &&
      !supported.has(c.codePointAt(0)!)
    )
      throw Error(
        `PDF 字体暂不支持字符“${c}”。请调整这个字符后重试，原内容已保留。`,
      );
  }
  const originals = [...doc.getPages()];
  const items = [...p.annotations].sort(
    (a, b) =>
      a.page - b.page ||
      Math.max(...b.rects.map((r) => r[3])) -
        Math.max(...a.rects.map((r) => r[3])),
  );
  const tocPages = Array.from(
    { length: Math.max(1, Math.ceil(items.length / 12)) },
    () => doc.addPage([WIDTH, HEIGHT]),
  );
  const sections: { a: Annotation; pages: PDFPage[] }[] = [];
  const pending: (() => void)[] = [];

  function text(
    page: PDFPage,
    value: string,
    x: number,
    top: number,
    size = 10.5,
    ink = INK,
  ) {
    page.drawText(pdfText(value), {
      x,
      y: page.getHeight() - top - size,
      size,
      font,
      color: color(ink),
    });
  }
  function box(
    page: PDFPage,
    x: number,
    top: number,
    width: number,
    height: number,
    fill = "#f3f8fa",
  ) {
    page.drawRectangle({
      x,
      y: page.getHeight() - top - height,
      width,
      height,
      color: color(fill),
      borderColor: color("#e1e9ed"),
      borderWidth: 0.5,
    });
  }
  function link(page: PDFPage, rect: number[], target: PDFPage | string) {
    const ref = doc.context.register(
      doc.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: rect,
        Border: [0, 0, 0],
        A:
          typeof target === "string"
            ? { S: "URI", URI: PDFString.of(new URL(target).href) }
            : { S: "GoTo", D: [target.ref, PDFName.of("Fit")] },
      }),
    );
    page.node.addAnnot(ref);
  }
  function button(
    page: PDFPage,
    label: string,
    x: number,
    top: number,
    width: number,
    target: PDFPage | string,
  ) {
    box(page, x, top, width, 25);
    const size = 8.5;
    text(
      page,
      label,
      x +
        Math.max(5, (width - font.widthOfTextAtSize(pdfText(label), size)) / 2),
      top + 6,
      size,
      ACCENT,
    );
    link(page, [x, HEIGHT - top - 25, x + width, HEIGHT - top], target);
  }
  function sectionPage(a: Annotation, ordinal: number, continued: boolean) {
    const page = doc.addPage([WIDTH, HEIGHT]);
    text(page, "图文补充", MARGIN, 29, 9, ACCENT);
    button(
      page,
      `← 返回简历第 ${a.page} 页`,
      WIDTH - MARGIN - 143,
      25,
      143,
      originals[a.page - 1],
    );
    page.drawRectangle({
      x: MARGIN,
      y: HEIGHT - 71,
      width: 32,
      height: 3,
      color: color(ACCENT),
    });
    text(page, String(ordinal).padStart(2, "0"), MARGIN, 84, 18, ACCENT);
    const title = pdfLines(
      a.title + (continued ? "（续）" : ""),
      font,
      18,
      WIDTH - MARGIN * 2 - 44,
    );
    for (let i = 0; i < title.length; i++)
      text(page, title[i], MARGIN + 44, 84 + i * 24, 18);
    const top = 99 + title.length * 24;
    text(
      page,
      `原简历第 ${a.page} 页 · 点击彩色标注查看补充内容`,
      MARGIN,
      top,
      9,
      MUTED,
    );
    return { page, top: top + 33 };
  }
  async function image(
    page: PDFPage,
    m: Media,
    x: number,
    top: number,
    cw: number,
    ch: number,
  ) {
    const source = await photoBytes(m, signal);
    const embedded = await doc.embedJpg(source.bytes);
    const layout = imageLayout(m);
    const fw = 314,
      fh =
        layout.height === "auto"
          ? (fw * source.height) / source.width
          : layout.height;
    const size = Math.min(cw / fw, ch / fh),
      w = fw * size,
      h = fh * size;
    const left = x + (cw - w) / 2,
      bottom = HEIGHT - top - ch + (ch - h) / 2;
    const fit =
      layout.fit === "contain"
        ? Math.min(fw / source.width, fh / source.height)
        : Math.max(fw / source.width, fh / source.height);
    const iw = source.width * fit * layout.zoom * size,
      ih = source.height * fit * layout.zoom * size;
    page.drawRectangle({
      x: left,
      y: bottom,
      width: w,
      height: h,
      color: color("#f0eaf6"),
    });
    page.pushOperators(
      pushGraphicsState(),
      rectangle(left, bottom, w, h),
      clip(),
      endPath(),
    );
    page.drawImage(embedded, {
      x: left + ((w - iw) * layout.x) / 100,
      y: bottom + (h - ih) * (1 - layout.y / 100),
      width: iw,
      height: ih,
    });
    page.pushOperators(popGraphicsState());
  }

  let photo = 0;
  const totalPhotos = items.reduce((n, a) => n + a.media.length, 0);
  for (let i = 0; i < items.length; i++) {
    signal?.throwIfAborted();
    const a = items[i],
      group = { a, pages: [] as PDFPage[] };
    sections.push(group);
    let current = sectionPage(a, i + 1, false);
    group.pages.push(current.page);
    function paragraph(value: string, size = 10.5, ink = INK) {
      for (const row of pdfLines(value, font, size, WIDTH - MARGIN * 2)) {
        if (current.top > 712) {
          current = sectionPage(a, i + 1, true);
          group.pages.push(current.page);
        }
        text(current.page, row, MARGIN, current.top, size, ink);
        current.top += 18;
      }
    }
    paragraph(a.body || "");
    for (const l of [
      ...a.links.map((l) => ({ title: l.label || l.url, url: l.url })),
      ...a.citations,
    ]) {
      for (const row of pdfLines(l.title, font, 9, WIDTH - MARGIN * 2)) {
        if (current.top > 710) {
          current = sectionPage(a, i + 1, true);
          group.pages.push(current.page);
        }
        text(current.page, row, MARGIN, current.top, 9, ACCENT);
        link(
          current.page,
          [
            MARGIN,
            HEIGHT - current.top - 15,
            WIDTH - MARGIN,
            HEIGHT - current.top + 2,
          ],
          l.url,
        );
        current.top += 16;
      }
    }
    for (let j = 0; j < a.media.length; j++)
      if (a.media[j].caption.trim())
        paragraph(`图片 ${j + 1} · ${a.media[j].caption}`, 9, MUTED);
    for (let offset = 0; offset < a.media.length; offset += 6) {
      signal?.throwIfAborted();
      if (current.top > 480 || offset > 0) {
        current = sectionPage(a, i + 1, true);
        group.pages.push(current.page);
      }
      const batch = a.media.slice(offset, offset + 6),
        n = batch.length,
        gap = 16;
      const top = current.top + 18,
        bottom = 736,
        width = WIDTH - MARGIN * 2;
      let cells: number[][];
      if (n === 1) cells = [[MARGIN, top, width, bottom - top]];
      else if (n === 3) {
        const hero = (bottom - top - gap) * 0.55,
          half = (width - gap) / 2;
        cells = [
          [MARGIN, top, width, hero],
          [MARGIN, top + hero + gap, half, bottom - top - hero - gap],
          [
            MARGIN + half + gap,
            top + hero + gap,
            half,
            bottom - top - hero - gap,
          ],
        ];
      } else {
        const stacked =
          n === 2 &&
          batch.every((m) => {
            const h = imageLayout(m).height;
            return typeof h === "number" && 314 / h > 1.15;
          });
        const cols = stacked ? 1 : n > 4 ? 3 : 2,
          count = Math.ceil(n / cols);
        const cw = (width - gap * (cols - 1)) / cols,
          ch = (bottom - top - gap * (count - 1)) / count;
        cells = batch.map((_, j) => [
          MARGIN + (j % cols) * (cw + gap),
          top + Math.floor(j / cols) * (ch + gap),
          cw,
          ch,
        ]);
      }
      for (let j = 0; j < batch.length; j++) {
        progress(`正在生成图文 PDF · 图片 ${++photo} / ${totalPhotos}`);
        const [x, y, w, h] = cells[j];
        await image(current.page, batch[j], x, y, w, h - 18);
        text(
          current.page,
          `${offset + j + 1} / ${a.media.length}`,
          x + w / 2 - 12,
          y + h - 13,
          7.5,
          MUTED,
        );
      }
    }
    for (const page of group.pages) {
      button(page, "全部图文目录", MARGIN, 755, 112, tocPages[0]);
      if (i > 0)
        button(
          page,
          "← 上一项",
          WIDTH - 268,
          755,
          104,
          sections[i - 1].pages[0],
        );
      if (i + 1 < items.length)
        pending.push(() =>
          button(
            page,
            "下一项 →",
            WIDTH - MARGIN - 112,
            755,
            112,
            sections[i + 1].pages[0],
          ),
        );
    }
  }
  for (let i = 0; i < tocPages.length; i++) {
    const page = tocPages[i];
    text(page, pdfText(p.name), MARGIN, 32, 10, ACCENT);
    text(page, "简历之外，还有故事", MARGIN, 78, 23);
    text(
      page,
      "点击条目查看图文，或点击前面简历中的彩色文字。",
      MARGIN,
      126,
      10,
      MUTED,
    );
    for (let j = 0; j < 12 && i * 12 + j < items.length; j++) {
      const index = i * 12 + j,
        y = 170 + j * 45;
      box(page, MARGIN, y, WIDTH - MARGIN * 2, 39);
      const label = pdfLines(
        items[index].title,
        font,
        11,
        WIDTH - MARGIN * 2 - 65,
      );
      text(
        page,
        `${String(index + 1).padStart(2, "0")}   ${label[0]}${label.length > 1 ? "…" : ""}`,
        MARGIN + 11,
        y + 10,
        11,
      );
      link(
        page,
        [MARGIN, HEIGHT - y - 39, WIDTH - MARGIN, HEIGHT - y],
        sections[index].pages[0],
      );
    }
    button(page, "← 返回简历", MARGIN, 755, 112, originals[0]);
    if (i > 0)
      button(page, "← 上一页目录", WIDTH - 286, 755, 112, tocPages[i - 1]);
    if (i + 1 < tocPages.length)
      button(
        page,
        "下一页目录 →",
        WIDTH - MARGIN - 126,
        755,
        126,
        tocPages[i + 1],
      );
  }
  for (const group of sections) {
    const page = originals[group.a.page - 1];
    for (const r of group.a.rects) {
      if (group.a.kind === "text")
        page.drawRectangle({
          x: r[0],
          y: r[1],
          width: r[2] - r[0],
          height: r[3] - r[1],
          color: color(group.a.color),
          blendMode: BlendMode.Lighten,
        });
      else
        page.drawRectangle({
          x: r[0],
          y: r[1],
          width: r[2] - r[0],
          height: r[3] - r[1],
          borderColor: color(group.a.color),
          borderWidth: 1,
        });
      link(page, [r[0] - 1, r[1] - 0.7, r[2] + 1, r[3] + 0.7], group.pages[0]);
    }
  }
  pending.forEach((fn) => fn());
  const pages = doc.getPages();
  for (let i = originals.length; i < pages.length; i++) {
    text(pages[i], "图文补充 · 点击返回简历继续阅读", MARGIN, 806, 8, MUTED);
    text(
      pages[i],
      `${i + 1} / ${pages.length}`,
      WIDTH - MARGIN - 60,
      806,
      8,
      MUTED,
    );
  }
  signal?.throwIfAborted();
  progress("正在打包可下载 PDF…");
  doc.setTitle(`${p.name} · 交互简历`);
  doc.setCreator("HoverCV");
  doc.setSubject("点击彩色标注跳转查看图文补充，点击返回简历继续阅读");
  const bytes = await doc.save();
  return {
    blob: new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
    filename: `${p.name.replace(/[\\/:*?"<>|]/g, "_")}_交互.pdf`,
    pages: pages.length,
  };
}
