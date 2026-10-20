import {
  PDFDict,
  PDFArray,
  PDFHexString,
  PDFNumber,
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

/** Original-page PDF with native MouseEnter/Hide form actions, like the user's sample. */
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
  const groups: { page: PDFPage; all: string[]; frames: string[][] }[] = [];
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
    doc.context.obj({ S: "JavaScript", JS: PDFString.of(script) });
  const enter = js("HC_keep();"),
    exit = js("HC_leave();");
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
      BS: { W: 0 },
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
      page.drawRectangle({
        x: 0.5,
        y: 0.5,
        width: w - 1,
        height: h - 1,
        color: color("#f2f7fc"),
        borderColor: color("#c5d8ed"),
        borderWidth: 0.6,
      });
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
  for (let i = 0; i < p.annotations.length; i++) {
    signal?.throwIfAborted();
    const a = p.annotations[i],
      page = originals[a.page - 1],
      crop = page.getCropBox();
    progress(`正在生成悬浮卡片 ${i + 1} / ${p.annotations.length}`);
    const w = Math.min(286, crop.width * 0.45),
      h = Math.min(430, crop.height - 24);
    if (w < 130 || h < 160)
      throw Error("这份 PDF 页面过小，无法放置可阅读的悬浮卡片。");
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
    const anchor = a.rects[0],
      right = anchor[2] + 7,
      left = anchor[0] - w - 7;
    const preferredX =
      right + w <= crop.x + crop.width - 8
        ? right
        : left >= crop.x + 8
          ? left
          : Math.max(crop.x + 8, crop.x + crop.width - w - 8);
    const preferredY = Math.min(
      crop.y + crop.height - h - 8,
      Math.max(crop.y + 8, anchor[3] - h),
    );
    // Avoid placing the card's controls over other source hotspots. Some
    // readers can still dispatch events to form controls behind a popup.
    const anchors = p.annotations
      .filter((note) => note.page === a.page)
      .flatMap((note) => note.rects);
    const overlap = (r: number[], s: number[]) =>
      Math.max(0, Math.min(r[2], s[2]) - Math.max(r[0], s[0])) *
      Math.max(0, Math.min(r[3], s[3]) - Math.max(r[1], s[1]));
    const xs = [preferredX, crop.x + 8, crop.x + crop.width - w - 8].filter(
      (v, j, all) => all.indexOf(v) === j,
    );
    const ys = [
      preferredY,
      crop.y + 8,
      crop.y + crop.height - h - 8,
      Math.min(
        crop.y + crop.height - h - 8,
        Math.max(crop.y + 8, anchor[1] - h - 7),
      ),
    ];
    let x = preferredX,
      y = preferredY,
      best = Infinity;
    for (const cx of xs)
      for (const cy of ys) {
        const card = [cx, cy, cx + w, cy + h],
          controls = [
            [cx + w - 30, cy + h - 30, cx + w - 8, cy + h - 8],
            [cx + 14, cy + 12, cx + 86, cy + 34],
            [cx + w - 86, cy + 12, cx + w - 14, cy + 34],
          ];
        const score =
          anchors.reduce(
            (sum, r) =>
              sum +
              overlap(card, r) * 10 +
              controls.reduce((v, c) => v + overlap(c, r) * 1000, 0),
            0,
          ) +
          ((cx - preferredX) ** 2 + (cy - preferredY) ** 2) * 0.01;
        if (score < best) {
          best = score;
          x = cx;
          y = cy;
        }
      }
    const rect = [x, y, x + w, y + h],
      group = { page, all: [] as string[], frames: [] as string[][] };
    groups.push(group);
    const closeName = `${prefix}${i}_close`,
      closeW = 22,
      closeH = 22;
    const closeRect = [x + w - 30, y + h - 30, x + w - 8, y + h - 8];
    group.all.push(closeName);
    const close = widget(
      page,
      closeName,
      closeRect,
      await buttonAppearance("×", closeW, closeH),
      true,
      "关闭注释",
    );
    close.set(PDFName.of("AA"), doc.context.obj({ E: enter, X: exit }));
    for (let s = 0; s < slides.length; s++) {
      signal?.throwIfAborted();
      const slide = slides[s],
        names = [closeName],
        panelName = `${prefix}${i}_panel_${s}`;
      const holes = [closeRect];
      names.push(panelName);
      group.all.push(panelName);
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
      const panel = widget(page, panelName, rect, ap, true, a.title);
      // A full-card editable button can intercept clicks on its own controls
      // in PDFium. The visual panel is read-only; separate empty hit regions
      // keep it open without covering the close/arrow/link buttons.
      panel.set(PDFName.of("Ff"), doc.context.obj(65537));
      for (let r = 0; r < slide.rows.length; r++)
        if (slide.rows[r].url) {
          const name = `${prefix}${i}_${s}_link_${r}`;
          names.push(name);
          group.all.push(name);
          const field = widget(
            page,
            name,
            [
              x + 14,
              y + h - top - r * 14 - 14,
              x + w - 14,
              y + h - top - r * 14 + 1,
            ],
            empty,
            true,
            slide.rows[r].text,
          );
          holes.push([
            x + 14,
            y + h - top - r * 14 - 14,
            x + w - 14,
            y + h - top - r * 14 + 1,
          ]);
          field.set(
            PDFName.of("A"),
            doc.context.obj({
              S: "URI",
              URI: PDFString.of(new URL(slide.rows[r].url!).href),
            }),
          );
          field.set(PDFName.of("AA"), doc.context.obj({ E: enter, X: exit }));
        }
      if (slides.length > 1)
        for (const [direction, label, bx] of [
          [-1, "← 上一项", x + 14],
          [1, "下一项 →", x + w - 86],
        ] as const) {
          const name = `${prefix}${i}_${s}_${direction < 0 ? "prev" : "next"}`;
          names.push(name);
          group.all.push(name);
          const field = widget(
            page,
            name,
            [bx, y + 12, bx + 72, y + 34],
            await buttonAppearance(label, 72, 22),
            true,
            label,
          );
          holes.push([bx, y + 12, bx + 72, y + 34]);
          field.set(PDFName.of("AA"), doc.context.obj({ E: enter, X: exit }));
          // Resolve after every frame name is known; no JavaScript is needed to flip.
          field.set(
            PDFName.of("HCtarget"),
            doc.context.obj((s + direction + slides.length) % slides.length),
          );
        }
      let keepers = [rect];
      for (const hole of holes) keepers = cutOut(keepers, hole);
      for (let k = 0; k < keepers.length; k++) {
        const name = `${prefix}${i}_${s}_keep_${k}`;
        names.push(name);
        group.all.push(name);
        const keeper = widget(page, name, keepers[k], empty, true, "");
        keeper.set(PDFName.of("AA"), doc.context.obj({ E: enter, X: exit }));
      }
      group.frames.push(names);
    }
    const show = (s: number) =>
      hide(group.all, true, hide(group.frames[s], false, js("HC_keep();")));
    for (const record of records.filter((r) => group.all.includes(r.name))) {
      const target = record.field.lookupMaybe(
        PDFName.of("HCtarget"),
        PDFNumber,
      );
      if (target) {
        const frame = target.asNumber(),
          direction = record.name.endsWith("_prev") ? "prev" : "next";
        const focusName = `${prefix}${i}_${frame}_${direction}`;
        // Some readers retain focus on the button just hidden by a flip.
        // When scripting is available, move it to the new visible button.
        record.field.set(
          PDFName.of("A"),
          hide(
            group.all,
            true,
            hide(
              group.frames[frame],
              false,
              js(
                `HC_keep();try{this.getField(${JSON.stringify(focusName)}).setFocus();}catch(e){}`,
              ),
            ),
          ),
        );
        record.field.delete(PDFName.of("HCtarget"));
      }
    }
    close.set(PDFName.of("A"), hide(group.all, true, js("HC_keep();")));
    // Transparent anchors go first in the annotation array, below the cards.
    for (let n = 0; n < a.rects.length; n++) {
      const r = a.rects[n],
        hit = widget(
          page,
          `${prefix}${i}_hover_${n}`,
          [r[0] - 1, r[1] - 1, r[2] + 1, r[3] + 1],
          empty,
          false,
          `${a.title}：悬停或单击查看图文`,
        );
      const open = hide(
        groups.filter((g) => g.page === page).flatMap((g) => g.all),
        true,
        show(0),
      );
      hit.set(
        PDFName.of("AA"),
        doc.context.obj({ E: open, Fo: open, X: exit }),
      );
      hit.set(PDFName.of("A"), open);
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
    for (const r of records.filter(
      (r) => r.page === page && r.name.includes("_hover_"),
    )) {
      const aa = r.field.lookup(PDFName.of("AA"), PDFDict),
        old = aa.get(PDFName.of("E"));
      const groupPrefix = r.name.split("_hover_")[0] + "_hover_";
      // An open card can cover another source word. Temporarily disable those
      // hidden-under-card hotspots so they cannot intercept the card's buttons.
      const otherHits = hitNames.filter((n) => !n.startsWith(groupPrefix));
      const open = hide(pageNames, true, hide(otherHits, true, old as PDFDict));
      aa.set(PDFName.of("E"), open);
      aa.set(PDFName.of("Fo"), open);
      r.field.set(PDFName.of("A"), open);
    }
    for (const r of records.filter(
      (r) => r.page === page && r.name.endsWith("_close"),
    ))
      r.field.set(
        PDFName.of("A"),
        hide(hitNames, false, r.field.lookup(PDFName.of("A"), PDFDict)),
      );
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
                  JS: PDFString.of("HC_keep();"),
                  Next: existing,
                })
              : js("HC_keep();"),
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
  const names = groups.flatMap((g) => g.all);
  const hitNames = records
    .filter((r) => r.name.includes("_hover_"))
    .map((r) => r.name);
  doc.addJavaScript(
    `${prefix}hover`,
    `var HC_doc=this,HC_timer=null;function HC_keep(){if(HC_timer!==null){try{app.clearTimeOut(HC_timer);}catch(e){}HC_timer=null;}}function HC_hide(){HC_keep();var n=${JSON.stringify(names)};for(var i=0;i<n.length;i++){var f=HC_doc.getField(n[i]);if(f)f.display=display.hidden;}var h=${JSON.stringify(hitNames)};for(var j=0;j<h.length;j++){var a=HC_doc.getField(h[j]);if(a)a.display=display.noPrint;}}function HC_leave(){HC_keep();try{HC_timer=app.setTimeOut("HC_hide();",150);}catch(e){}}`,
  );
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
  const bytes = await doc.save({ updateFieldAppearances: false });
  return {
    blob: new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
    filename,
    pages: originals.length,
  };
}
