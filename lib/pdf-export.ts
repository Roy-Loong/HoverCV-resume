import {
  PDFDict,
  PDFArray,
  PDFHexString,
  degrees,
  type PDFRef,
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
import { pdfHoverRuntime } from "./pdf-hover-runtime";
import { PDF_CARD_WIDTH, PDF_CARD_HEIGHT } from "./card-layout";

export type PdfProgress = (message: string) => void;
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

/** Adjacent glyph/radical boxes on the same line share one native trigger.
 * Some CJK PDFs split even one character into overlapping text rectangles.
 */
export function pdfCardAnchors(rects: Annotation["rects"]) {
  const out: number[][] = [];
  for (const rect of rects) {
    let merged: number[] = [...rect];
    for (let i = 0; i < out.length;) {
      const r = out[i],
        overlap = Math.min(r[3], merged[3]) - Math.max(r[1], merged[1]),
        minHeight = Math.min(r[3] - r[1], merged[3] - merged[1]);
      if (
        overlap >= minHeight * 0.55 &&
        merged[0] <= r[2] + 3 &&
        merged[2] >= r[0] - 3
      ) {
        merged = [
          Math.min(r[0], merged[0]),
          Math.min(r[1], merged[1]),
          Math.max(r[2], merged[2]),
          Math.max(r[3], merged[3]),
        ];
        out.splice(i, 1);
        i = 0;
      } else i++;
    }
    out.push(merged);
  }
  return out;
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

/** Original-page PDF with native hover/click actions and the web card's size. */
export async function buildInteractivePdf(
  input: Project,
  progress: PdfProgress = () => {},
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const p = projectSchema.parse(input);
  const filename = `${p.name.replace(/[\\/:*?"<>|]/g, "_")}_悬浮交互.pdf`;
  if (p.annotations.some((a) => a.media.some((m) => m.type === "video")))
    throw Error(
      "悬浮 PDF 当前支持文字和静态图片。项目含视频，请使用 HTML 或离线 ZIP 保留视频；原内容未改动。",
    );
  if (!p.annotations.length)
    return {
      blob: new Blob([dataToBytes(p.pdfData)], { type: "application/pdf" }),
      filename,
      pages: p.pages.length,
    };
  progress("正在准备悬浮 PDF 字体…");
  const [response, { default: fontkit }] = await Promise.all([
    fetch("/fonts/DroidSansFallback.ttf", { signal }),
    import("@pdf-lib/fontkit"),
  ]);
  if (!response.ok) throw Error("PDF 字体下载失败，请检查网络后重试。");
  const doc = await PDFDocument.load(dataToBytes(p.pdfData));
  doc.registerFontkit(fontkit);
  // This font's subsets can be extractable but invisible. Keep the full font.
  const font = await doc.embedFont(await response.arrayBuffer(), {
    subset: false,
  });
  const supported = new Set(font.getCharacterSet());
  const content = pdfText(
    p.annotations
      .map(
        (a) =>
          a.title +
          a.body +
          a.media.map((m) => m.caption).join("") +
          a.links.map((l) => l.label || l.url).join("") +
          a.citations.map((c) => c.title).join(""),
      )
      .join(""),
  );
  for (const c of content)
    if (!/[\n\r\t]/.test(c) && !supported.has(c.codePointAt(0)!))
      throw Error(
        `PDF 字体暂不支持字符“${c}”。请调整这个字符后重试，原内容已保留。`,
      );
  const originals = [...doc.getPages()];
  const form = doc.getForm();
  form.acroForm.dict.set(PDFName.of("NeedAppearances"), doc.context.obj(false));
  const prefix = `HC${crypto.randomUUID().replaceAll("-", "")}_`;
  const records: { page: PDFPage; field: PDFDict; name: string }[] = [];
  type Mode = "h" | "t";
  type Group = {
    page: PDFPage;
    all: string[];
    h: string[][];
    t: string[][];
    hit: string;
    controls: {
      field: PDFDict;
      mode: Mode;
      frame: number;
      target?: number;
      close?: boolean;
    }[];
  };
  const groups: Group[] = [];
  // A shared bootstrap also initializes readers that skip document-level JS.
  const bootstrap = doc.context.register(doc.context.obj({ S: "JavaScript" }));
  const empty = doc.context.register(
    doc.context.flateStream("q Q", {
      Type: "XObject",
      Subtype: "Form",
      FormType: 1,
      BBox: [0, 0, 1, 1],
      Resources: {},
    }),
  );
  const hide = (names: string[], hidden: boolean, next?: PDFDict) =>
    doc.context.obj({
      S: "Hide",
      T: names.map((n) => PDFString.of(n)),
      H: hidden,
      ...(next ? { Next: next } : {}),
    });
  const js = (script: string) =>
    doc.context.obj({
      S: "JavaScript",
      JS: PDFString.of(script),
    });
  const run = (script: string) =>
    doc.context.obj({
      S: "JavaScript",
      JS: PDFString.of(""),
      Next: [bootstrap, js(script)],
    });
  function widget(
    page: PDFPage,
    name: string,
    rect: number[],
    appearance: PDFRef,
    hidden: boolean,
    label: string,
  ) {
    const field = doc.context.obj({
      Type: "Annot",
      Subtype: "Widget",
      FT: "Btn",
      Ff: 65536,
      T: PDFString.of(name),
      TU: PDFHexString.fromText(label),
      Rect: rect,
      F: hidden ? 2 : 0,
      H: "N",
      Border: [0, 0, 0],
      BS: { W: 0 },
      MK: { BC: [], BG: [] },
      AP: { N: appearance },
      P: page.ref,
    });
    const ref = doc.context.register(field);
    form.acroForm.addField(ref);
    page.node.addAnnot(ref);
    records.push({ page, field, name });
    return field;
  }
  function drawText(
    page: PDFPage,
    value: string,
    x: number,
    top: number,
    size = 9.5,
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
  async function appearance(
    w: number,
    h: number,
    paint: (page: PDFPage) => void | Promise<void>,
  ) {
    const scratch = doc.addPage([w, h]);
    try {
      await paint(scratch);
      const embedded = await doc.embedPage(scratch);
      await embedded.embed();
      return embedded.ref;
    } finally {
      doc.removePage(doc.getPageCount() - 1);
    }
  }
  async function buttonAppearance(label: string, w: number, h: number) {
    return appearance(w, h, (page) => {
      drawText(
        page,
        label,
        Math.max(5, (w - font.widthOfTextAtSize(label, 9)) / 2),
        5,
        9,
        ACCENT,
      );
    });
  }
  const photoCache = new Map<Media, Awaited<ReturnType<typeof photoBytes>>>();
  async function drawPhoto(
    page: PDFPage,
    m: Media,
    x: number,
    top: number,
    w: number,
    h: number,
  ) {
    const source = photoCache.get(m) ?? (await photoBytes(m, signal));
    photoCache.set(m, source);
    const embedded = await doc.embedJpg(source.bytes),
      layout = imageLayout(m),
      fw = 314,
      fh =
        layout.height === "auto"
          ? (314 * source.height) / source.width
          : layout.height;
    const scale = Math.min(w / fw, h / fh),
      width = fw * scale,
      height = fh * scale,
      left = x + (w - width) / 2,
      bottom = page.getHeight() - top - h + (h - height) / 2;
    const fit =
      layout.fit === "contain"
        ? Math.min(fw / source.width, fh / source.height)
        : Math.max(fw / source.width, fh / source.height);
    const iw = source.width * fit * layout.zoom * scale,
      ih = source.height * fit * layout.zoom * scale;
    page.drawRectangle({
      x: left,
      y: bottom,
      width,
      height,
      color: color("#f0eaf6"),
    });
    page.pushOperators(
      pushGraphicsState(),
      rectangle(left, bottom, width, height),
      clip(),
      endPath(),
    );
    page.drawImage(embedded, {
      x: left + ((width - iw) * layout.x) / 100,
      y: bottom + (height - ih) * (1 - layout.y / 100),
      width: iw,
      height: ih,
    });
    page.pushOperators(popGraphicsState());
  }
  type Row = { text: string; url?: string };
  function cutOut(rects: number[][], hole: number[]) {
    return rects.flatMap((r) => {
      const x0 = Math.max(r[0], hole[0]),
        y0 = Math.max(r[1], hole[1]),
        x1 = Math.min(r[2], hole[2]),
        y1 = Math.min(r[3], hole[3]);
      if (x1 <= x0 || y1 <= y0) return [r];
      return [
        [r[0], r[1], r[2], y0],
        [r[0], y1, r[2], r[3]],
        [r[0], y0, x0, y1],
        [x1, y0, r[2], y1],
      ].filter((s) => s[2] - s[0] > 0.1 && s[3] - s[1] > 0.1);
    });
  }
  // One document-wide size, including mixed page sizes. Never move a card to
  // a distant page corner just to avoid another annotation.
  const cardScale = Math.min(
    1,
    ...originals.flatMap((page) => {
      const crop = page.getCropBox();
      return [
        (crop.width - 16) / PDF_CARD_WIDTH,
        (crop.height - 16) / PDF_CARD_HEIGHT,
      ];
    }),
  );
  const w = PDF_CARD_WIDTH * cardScale,
    h = PDF_CARD_HEIGHT * cardScale;
  if (w < 130 || h < 160)
    throw Error("这份 PDF 页面过小，无法放置可阅读的悬浮卡片。");
  const closeAp = await buttonAppearance("×", 22, 22),
    prevAp = await buttonAppearance("← 上一项", 72, 22),
    nextAp = await buttonAppearance("下一项 →", 72, 22);
  for (let i = 0; i < p.annotations.length; i++) {
    signal?.throwIfAborted();
    const a = p.annotations[i],
      page = originals[a.page - 1],
      crop = page.getCropBox();
    progress(`正在生成悬浮卡片 ${i + 1} / ${p.annotations.length}`);
    const fullTitle = pdfLines(a.title, font, 14, w - 48),
      title = fullTitle.slice(0, 2);
    if (fullTitle.length > 2) title[1] += "…";
    const top = 19 + title.length * 19 + 14;
    const rows: Row[] = [];
    const addRows = (value: string, url?: string) =>
      rows.push(
        ...pdfLines(value, font, 9.5, w - 28).map((text) => ({ text, url })),
      );
    if (fullTitle.length > 2) addRows(a.title);
    addRows(a.body || "");
    for (let n = 0; n < a.media.length; n++)
      if (a.media[n].caption.trim())
        addRows(`图片 ${n + 1} · ${a.media[n].caption}`);
    for (const l of [
      ...a.links.map((l) => ({ title: l.label || l.url, url: l.url })),
      ...a.citations,
    ])
      addRows(l.title, l.url);
    const available = h - top - 47,
      capacity = Math.max(1, Math.floor(available / 14));
    const short =
      rows.length <= Math.min(9, Math.floor((available - 110) / 14));
    const slides: { rows: Row[]; media?: Media }[] = [];
    if (short)
      for (let n = 0; n < Math.max(1, a.media.length); n++)
        slides.push({ rows, media: a.media[n] });
    else {
      for (let start = 0; start < rows.length; start += capacity)
        slides.push({ rows: rows.slice(start, start + capacity) });
      for (const media of a.media) slides.push({ rows: [], media });
    }
    // Reuse the same form appearances for every fragment and click/hover mode;
    // duplicating the widgets must not duplicate photos or embedded fonts.
    const appearances: PDFRef[] = [];
    for (let s = 0; s < slides.length; s++) {
      const slide = slides[s];
      const ap = await appearance(w, h, async (canvas) => {
        canvas.drawRectangle({
          x: 0.5,
          y: 0.5,
          width: w - 1,
          height: h - 1,
          color: rgb(1, 1, 1),
          borderColor: color("#a8c6e6"),
          borderWidth: 0.8,
        });
        for (let t = 0; t < title.length; t++)
          drawText(canvas, title[t], 14, 16 + t * 19, 14, ACCENT);
        for (let r = 0; r < slide.rows.length; r++)
          drawText(
            canvas,
            slide.rows[r].text,
            14,
            top + r * 14,
            9.5,
            slide.rows[r].url ? ACCENT : INK,
          );
        const imageTop = top + slide.rows.length * 14 + 10,
          imageHeight = h - 47 - imageTop;
        if (slide.media)
          await drawPhoto(
            canvas,
            slide.media,
            14,
            imageTop,
            w - 28,
            imageHeight,
          );
        drawText(
          canvas,
          `${s + 1} / ${slides.length}`,
          w / 2 - 14,
          h - 29,
          8,
          MUTED,
        );
      });
      appearances.push(ap);
    }
    for (const anchor of pdfCardAnchors(a.rects)) {
      const id = groups.length,
        right = anchor[2] + 6,
        left = anchor[0] - w - 6;
      const fitsRight = right + w <= crop.x + crop.width - 8,
        fitsLeft = left >= crop.x + 8;
      const x = fitsRight
        ? right
        : fitsLeft
          ? left
          : Math.max(crop.x + 8, crop.x + crop.width - w - 8);
      let y = Math.max(
        crop.y + 8,
        Math.min(anchor[3] + 4 - h, crop.y + crop.height - h - 8),
      );
      // At a page edge, stay on the original page without covering the source
      // word or moving to a distant corner. A very long line uses the space
      // directly below/above instead of obscuring its own click trigger.
      if (!fitsRight && !fitsLeft) {
        if (anchor[1] - 6 - h >= crop.y + 8) y = anchor[1] - 6 - h;
        else if (anchor[3] + 6 + h <= crop.y + crop.height - 8)
          y = anchor[3] + 6;
      }
      const rect = [x, y, x + w, y + h],
        group: Group = {
          page,
          all: [],
          h: [],
          t: [],
          hit: `${prefix}${id}_hover_0`,
          controls: [],
        };
      groups.push(group);
      for (const mode of ["h", "t"] as const)
        for (let frame = 0; frame < slides.length; frame++) {
          const names: string[] = [],
            holes: number[][] = [];
          const add = (
            suffix: string,
            r: number[],
            ap: PDFRef,
            label: string,
          ) => {
            const name = `${prefix}${id}_${mode}_${suffix}`;
            names.push(name);
            group.all.push(name);
            const field = widget(page, name, r, ap, true, label);
            group.controls.push({ field, mode, frame });
            return field;
          };
          const panelName = `${prefix}${id}_${mode}_panel_${frame}`;
          names.push(panelName);
          group.all.push(panelName);
          const panel = widget(
            page,
            panelName,
            rect,
            appearances[frame],
            true,
            a.title,
          );
          panel.set(PDFName.of("Ff"), doc.context.obj(65537));
          const closeRect = [x + w - 30, y + h - 30, x + w - 8, y + h - 8];
          holes.push(closeRect);
          add(`${frame}_close`, closeRect, closeAp, "关闭注释");
          group.controls.at(-1)!.close = true;
          for (let r = 0; r < slides[frame].rows.length; r++) {
            const row = slides[frame].rows[r];
            if (!row.url) continue;
            const linkRect = [
              x + 14,
              y + h - top - r * 14 - 14,
              x + w - 14,
              y + h - top - r * 14 + 1,
            ];
            holes.push(linkRect);
            add(`${frame}_link_${r}`, linkRect, empty, row.text).set(
              PDFName.of("A"),
              doc.context.obj({
                S: "URI",
                URI: PDFString.of(new URL(row.url).href),
              }),
            );
          }
          if (slides.length > 1)
            for (const [direction, label, bx, ap] of [
              [-1, "← 上一项", x + 14, prevAp],
              [1, "下一项 →", x + w - 86, nextAp],
            ] as const) {
              const r = [bx, y + 12, bx + 72, y + 34];
              holes.push(r);
              add(`${frame}_${direction < 0 ? "prev" : "next"}`, r, ap, label);
              group.controls.at(-1)!.target =
                (frame + direction + slides.length) % slides.length;
            }
          let keepers = [rect];
          for (const hole of holes) keepers = cutOut(keepers, hole);
          // The bridge keeps the 150 ms hover transition close to its word.
          // Without scripting, click the word to pin before using controls.
          if (x > anchor[2])
            keepers.push([
              anchor[2],
              Math.max(y, anchor[1] - 1),
              x,
              Math.min(y + h, anchor[3] + 1),
            ]);
          for (let k = 0; k < keepers.length; k++)
            if (keepers[k][2] > keepers[k][0] && keepers[k][3] > keepers[k][1])
              // Read-only pushbuttons still receive Enter/Exit, but cannot
              // take input focus and draw a reader's rectangle over the title.
              add(`${frame}_keep_${k}`, keepers[k], empty, "").set(
                PDFName.of("Ff"),
                doc.context.obj(65537),
              );
          group[mode].push(names);
        }
      widget(
        page,
        group.hit,
        [anchor[0] - 1, anchor[1] - 1, anchor[2] + 1, anchor[3] + 1],
        empty,
        false,
        `${a.title}：悬停查看，单击固定，×关闭`,
      );
    }
  }
  // Every trigger closes other cards on its page, including cards created later.
  for (const page of originals) {
    const pageNames = groups
      .filter((g) => g.page === page)
      .flatMap((g) => g.all);
    const hits = records.filter(
      (r) => r.page === page && r.name.includes("_hover_"),
    );
    const hitNames = hits.map((r) => r.name);
    for (let id = 0; id < groups.length; id++) {
      const group = groups[id];
      if (group.page !== page) continue;
      const hoverNames = group.h.flat(),
        otherHits = hitNames.filter((n) => n !== group.hit);
      const state = (frame: number, mode: Mode) =>
        run(`HC_open(${id},${frame},${mode === "t"});`);
      const show = (frame: number, mode: Mode) =>
        hide(
          group.all,
          true,
          hide(group[mode][frame], false, state(frame, mode)),
        );
      const leave = (frame: number) =>
        hide(hoverNames, true, run(`HC_leave(${id},${frame});`));
      const hit = hits.find((r) => r.name === group.hit)!.field;
      // Native-only hover leaves source words available after immediate
      // closing. Pinned cards disable covered words until × is pressed, so a
      // read-only card body cannot click through into a different annotation.
      const open = (mode: Mode) =>
        hide(
          pageNames,
          true,
          hide(
            mode === "t" ? otherHits : hitNames,
            mode === "t",
            show(0, mode),
          ),
        );
      hit.set(
        PDFName.of("AA"),
        doc.context.obj({ E: open("h"), Fo: open("t"), X: leave(0) }),
      );
      hit.set(PDFName.of("A"), open("t"));
      for (const c of group.controls) {
        c.field.set(
          PDFName.of("AA"),
          doc.context.obj({
            E:
              c.mode === "t"
                ? hide(otherHits, true, show(c.frame, c.mode))
                : show(c.frame, c.mode),
            X: c.mode === "h" ? leave(c.frame) : run("HC_keep();"),
          }),
        );
        if (c.close)
          c.field.set(
            PDFName.of("A"),
            hide(pageNames, true, hide(hitNames, false, run("HC_hide();"))),
          );
        else if (c.target !== undefined) {
          const direction = records
            .find((r) => r.field === c.field)!
            .name.endsWith("_prev")
            ? "prev"
            : "next";
          const focusName = `${prefix}${id}_${c.mode}_${c.target}_${direction}`;
          const action = show(c.target, c.mode);
          // A reader may keep keyboard focus on the now-hidden old frame.
          action.set(
            PDFName.of("Next"),
            doc.context.obj({
              S: "Hide",
              T: group[c.mode][c.target].map((n) => PDFString.of(n)),
              H: false,
              Next: run(
                `HC_open(${id},${c.target},${c.mode === "t"});try{this.getField(${JSON.stringify(focusName)}).setFocus();}catch(e){}`,
              ),
            }),
          );
          c.field.set(PDFName.of("A"), action);
        }
      }
    }
    const annots = page.node.Annots();
    if (annots) {
      const own = new Set(
        records.filter((r) => r.page === page).map((r) => r.name),
      );
      const anchors: PDFRef[] = [],
        panels: PDFRef[] = [],
        controls: PDFRef[] = [],
        original: PDFRef[] = [];
      for (let n = 0; n < annots.size(); n++) {
        const ref = annots.get(n) as PDFRef,
          field = doc.context.lookup(ref, PDFDict),
          value = field.get(PDFName.of("T")),
          name =
            value instanceof PDFString || value instanceof PDFHexString
              ? value.decodeText()
              : undefined;
        (name && own.has(name)
          ? name.includes("_hover_")
            ? anchors
            : name.includes("_panel_")
              ? panels
              : controls
          : original
        ).push(ref);
      }
      page.node.set(
        PDFName.of("Annots"),
        doc.context.obj([...original, ...anchors, ...panels, ...controls]),
      );
    }
    if (pageNames.length) {
      const aa =
        page.node.lookupMaybe(PDFName.of("AA"), PDFDict) ?? doc.context.obj({});
      const existing = aa.get(PDFName.of("C"));
      aa.set(
        PDFName.of("C"),
        hide(
          pageNames,
          true,
          hide(
            hitNames,
            false,
            existing
              ? doc.context.obj({
                  S: "JavaScript",
                  JS: PDFString.of(""),
                  Next: [bootstrap, js("HC_hide();"), existing],
                })
              : run("HC_hide();"),
          ),
        ),
      );
      page.node.set(PDFName.of("AA"), aa);
    }
  }
  // Keep source fields intact and separate the visual panels from controls.
  const fields = form.acroForm.dict.lookup(PDFName.of("Fields"), PDFArray);
  const originalFields: PDFRef[] = [],
    anchorFields: PDFRef[] = [],
    panelFields: PDFRef[] = [],
    controlFields: PDFRef[] = [];
  for (let i = 0; i < fields.size(); i++) {
    const ref = fields.get(i) as PDFRef,
      field = doc.context.lookup(ref, PDFDict),
      value = field.get(PDFName.of("T"));
    const name =
      value instanceof PDFString || value instanceof PDFHexString
        ? value.decodeText()
        : "";
    (name.startsWith(prefix)
      ? name.includes("_hover_")
        ? anchorFields
        : name.includes("_panel_")
          ? panelFields
          : controlFields
      : originalFields
    ).push(ref);
  }
  form.acroForm.dict.set(
    PDFName.of("Fields"),
    doc.context.obj([
      ...originalFields,
      ...anchorFields,
      ...panelFields,
      ...controlFields,
    ]),
  );
  const runtime = pdfHoverRuntime({
    groups: groups.map((g) => ({
      hover: g.h,
      pinned: g.t,
      hit: g.hit,
      page: originals.indexOf(g.page),
    })),
  });
  doc.context
    .lookup(bootstrap, PDFDict)
    .set(
      PDFName.of("JS"),
      doc.context.register(doc.context.flateStream(runtime)),
    );
  doc.addJavaScript(`${prefix}hover`, "");
  progress("正在生成清晰的标注文字…");
  const { pdfAnchorImages } = await import("./pdf-anchor-images");
  for (const patch of await pdfAnchorImages(p, signal)) {
    const image = await doc.embedPng(patch.bytes),
      [x0, y0, x1, y1] = patch.rect,
      rotation = ((patch.rotation % 360) + 360) % 360;
    const x = rotation === 90 || rotation === 180 ? x1 : x0,
      y = rotation === 180 || rotation === 270 ? y1 : y0;
    originals[patch.page - 1].drawImage(image, {
      x,
      y,
      width: rotation % 180 ? y1 - y0 : x1 - x0,
      height: rotation % 180 ? x1 - x0 : y1 - y0,
      rotate: degrees(rotation),
    });
  }
  signal?.throwIfAborted();
  progress("正在打包悬浮交互 PDF…");
  doc.setTitle(`${p.name} · 悬浮交互简历`);
  doc.setCreator("HoverCV");
  doc.setSubject(
    "保留原页数；支持 PDF 表单交互的阅读器可悬停或点击查看图文、翻图与关闭。",
  );
  await doc.flush();
  // Use one shared stream for document initialization and event bootstrapping.
  // Long/multi-fragment resumes can exceed PDF's literal-string size limit.
  const jsNames = doc.catalog
    .lookup(PDFName.of("Names"), PDFDict)
    .lookup(PDFName.of("JavaScript"), PDFDict)
    .lookup(PDFName.of("Names"), PDFArray);
  jsNames.set(jsNames.size() - 1, bootstrap);
  const bytes = await doc.save({ updateFieldAppearances: false });
  return {
    blob: new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
    filename,
    pages: originals.length,
  };
}
