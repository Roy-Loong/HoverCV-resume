import {
  PDFDict,
  PDFArray,
  PDFHexString,
  degrees,
  type PDFRef,
  PDFDocument,
  PDFName,
  PDFString,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import {
  dataToBytes,
  projectSchema,
  type Annotation,
  type Project,
} from "./schema";
import { renderPdfCards } from "./pdf-card-render";
import { APP_VERSION } from "./version";
import { HOVER_CARD_WIDTH, HOVER_CARD_HEIGHT } from "./card-layout";
import { pdfHoverRuntime } from "./pdf-hover-runtime";
import { PDF_CARD_WIDTH, PDF_CARD_HEIGHT } from "./card-layout";

export type PdfProgress = (message: string) => void;
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

export function pdfPointerBridge(source: number[], card: number[]) {
  const overlapY = [Math.max(source[1], card[1]), Math.min(source[3], card[3])];
  if (source[2] <= card[0])
    return [source[2], overlapY[0] - 3, card[0], overlapY[1] + 3];
  if (card[2] <= source[0])
    return [card[2], overlapY[0] - 3, source[0], overlapY[1] + 3];
  const overlapX = [Math.max(source[0], card[0]), Math.min(source[2], card[2])];
  if (card[3] <= source[1])
    return [overlapX[0] - 3, card[3], overlapX[1] + 3, source[1]];
  if (source[3] <= card[1])
    return [overlapX[0] - 3, source[3], overlapX[1] + 3, card[1]];
  return [...source];
}

/** Original-page PDF with native hover/click actions and the web card's size. */
export async function buildInteractivePdf(
  input: Project,
  progress: PdfProgress = () => {},
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const p = projectSchema.parse(input);
  const filename = `${p.name.replace(/[\\/:*?"<>|]/g, "_")}_悬浮交互_v${APP_VERSION}.pdf`;
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
  progress("正在准备网页同款悬浮卡片…");
  const doc = await PDFDocument.load(dataToBytes(p.pdfData));
  const originals = [...doc.getPages()];
  const form = doc.getForm();
  form.acroForm.dict.set(PDFName.of("NeedAppearances"), doc.context.obj(false));
  const prefix = `HC${crypto.randomUUID().replaceAll("-", "")}_`;
  const records: {
    page: PDFPage;
    field: PDFDict;
    name: string;
    rect: number[];
  }[] = [];
  type Mode = "h" | "t";
  type Group = {
    page: PDFPage;
    all: string[];
    h: string[][];
    t: string[][];
    exits: string[];
    transit: string[];
    outer: string[];
    nav: Record<string, number>[];
    hit: string;
    controls: {
      field: PDFDict;
      mode: Mode;
      frame: number;
      target?: number;
      close?: boolean;
      panel?: boolean;
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
      // Retain the card as a real button icon as well as its appearance.
      // Readers regenerate AP when rect changes; AP alone would be erased.
      MK: {
        BC: [],
        BG: [],
        I: appearance,
        TP: 1,
        IF: { SW: "A", S: "P", A: [0.5, 0.5], FB: true },
      },
      AP: { N: appearance },
      P: page.ref,
    });
    const ref = doc.context.register(field);
    form.acroForm.addField(ref);
    page.node.addAnnot(ref);
    records.push({ page, field, name, rect });
    return field;
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
  for (let i = 0; i < p.annotations.length; i++) {
    signal?.throwIfAborted();
    const a = p.annotations[i],
      page = originals[a.page - 1],
      crop = page.getCropBox();
    progress(`正在生成悬浮卡片 ${i + 1} / ${p.annotations.length}`);
    const slides = await renderPdfCards(a, signal);
    const appearances: PDFRef[] = [];
    for (const slide of slides) {
      const image = await doc.embedPng(slide.png);
      appearances.push(
        await appearance(w, h, (canvas) => {
          canvas.drawImage(image, { x: 0, y: 0, width: w, height: h });
        }),
      );
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
        sourceRect = [
          anchor[0] - 1,
          anchor[1] - 1,
          anchor[2] + 1,
          anchor[3] + 1,
        ],
        // Only the narrow word-to-card corridor is protected. A large bounding
        // rectangle would keep the card open in blank space beside its body.
        bridge = pdfPointerBridge(sourceRect, rect),
        readingRegions = [sourceRect, rect, bridge],
        group: Group = {
          page,
          all: [],
          h: [],
          t: [],
          exits: [],
          transit: [],
          outer: [],
          nav: slides.map((s) =>
            Object.fromEntries(
              s.controls
                .filter((c) => c.target !== undefined)
                .map((c) => [c.action, c.target!]),
            ),
          ),
          hit: `${prefix}${id}_hover_0`,
          controls: [],
        };
      groups.push(group);
      for (const mode of ["h", "t"] as const)
        for (let frame = 0; frame < slides.length; frame++) {
          const names: string[] = [];
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
            slides[frame].text,
          );
          // Keep the whole card interactive so WPS can dispatch its Exit even
          // when the pointer jumps off the PDF page. Unlike the old partial
          // body fields, its focus boundary coincides with the outer card.
          group.controls.push({ field: panel, mode, frame, panel: true });
          for (let n = 0; n < slides[frame].controls.length; n++) {
            const control = slides[frame].controls[n];
            const [l, t, r, b] = control.rect;
            const area = [
              x + (l * w) / HOVER_CARD_WIDTH,
              y + h - (b * h) / HOVER_CARD_HEIGHT,
              x + (r * w) / HOVER_CARD_WIDTH,
              y + h - (t * h) / HOVER_CARD_HEIGHT,
            ];
            const suffix =
              control.action === "link"
                ? `${frame}_link_${n}`
                : `${frame}_${control.action}`;
            const field = add(suffix, area, empty, control.label);
            if (control.action === "close") group.controls.at(-1)!.close = true;
            else if (control.url)
              field.set(
                PDFName.of("A"),
                doc.context.obj({
                  S: "URI",
                  URI: PDFString.of(new URL(control.url).href),
                }),
              );
            else if (control.target !== undefined)
              group.controls.at(-1)!.target = control.target;
          }
          // The whole card panel receives body events. Extra read-only body
          // widgets can swallow Enter in WPS and create inner focus boxes.
          group[mode].push(names);
        }
      const transferRect = [
        Math.min(sourceRect[0], rect[0]),
        Math.min(sourceRect[1], rect[1]),
        Math.max(sourceRect[2], rect[2]),
        Math.max(sourceRect[3], rect[3]),
      ];
      const travel = cutOut(cutOut([transferRect], rect), sourceRect);
      for (let k = 0; k < travel.length; k++) {
        const name = `${prefix}${id}_travel_${k}`;
        group.transit.push(name);
        group.all.push(name);
        widget(page, name, travel[k], empty, true, "").set(
          PDFName.of("AA"),
          doc.context.obj({
            E: run(`HC_transfer(${id});`),
            X: run(`if(HC_active===${id})HC_leave(${id},HC_frame);`),
          }),
        );
      }
      const outer = cutOut(
        [[crop.x, crop.y, crop.x + crop.width, crop.y + crop.height]],
        transferRect,
      );
      for (let k = 0; k < outer.length; k++) {
        const name = `${prefix}${id}_outer_${k}`;
        group.transit.push(name);
        group.outer.push(name);
        group.all.push(name);
        widget(page, name, outer[k], empty, true, "");
      }
      // Native closing happens outside the whole reading region, never on
      // the internal boundary between the word, bridge and card. This also
      // works when a reader runs Hide actions but ignores JavaScript timers.
      let outside = [
        [crop.x, crop.y, crop.x + crop.width, crop.y + crop.height],
      ];
      for (const region of readingRegions) outside = cutOut(outside, region);
      for (let k = 0; k < outside.length; k++) {
        const name = `${prefix}${id}_exit_${k}`;
        group.exits.push(name);
        group.all.push(name);
        // WPS may omit pointer events on read-only widgets. These invisible
        // outside guards must be interactive; they never paint a field border.
        widget(page, name, outside[k], empty, true, "");
      }
      widget(
        page,
        group.hit,
        sourceRect,
        empty,
        false,
        `${a.title}：悬停查看，移入继续阅读，移出自动关闭`,
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
      const otherHits = hitNames.filter((n) => n !== group.hit);
      const state = (frame: number, mode: Mode, inside = true) =>
        run(`HC_open(${id},${frame},${mode === "t"},${inside});`);
      const visible = (frame: number, mode: Mode, inside = true) => [
        ...group[mode][frame],
        ...(inside ? group.exits : group.transit),
      ];
      const show = (frame: number, mode: Mode, inside = true) =>
        hide(
          group.all,
          true,
          hide(visible(frame, mode, inside), false, state(frame, mode, inside)),
        );
      const leave = (frame: number) => run(`HC_leave(${id},${frame});`);
      const hit = hits.find((r) => r.name === group.hit)!.field;
      // The outside guards restore source words when the reading region is
      // left, so covered words can stay suppressed even without scripting.
      const open = (mode: Mode) =>
        hide(pageNames, true, hide(otherHits, true, show(0, mode, false)));
      hit.set(PDFName.of("AA"), doc.context.obj({ E: open("h"), X: leave(0) }));
      hit.set(PDFName.of("A"), open("t"));
      for (const c of group.controls) {
        if (c.panel) {
          c.field.set(
            PDFName.of("AA"),
            doc.context.obj({
              E: hide(
                group.transit,
                true,
                hide(group.exits, false, run(`HC_enter(${id});`)),
              ),
              X: leave(c.frame),
            }),
          );
          continue;
        }
        c.field.set(
          PDFName.of("AA"),
          doc.context.obj({
            // Do not hide/re-show the active card on every pointer crossing:
            // that can emit another Exit and restart closing from inside it.
            E: hide(
              otherHits,
              true,
              hide(
                group.transit,
                true,
                hide(visible(c.frame, c.mode), false, run(`HC_touch(${id});`)),
              ),
            ),
            X: leave(c.frame),
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
            .name.split("_")
            .at(-1)!;
          const action = hide(
            group.all,
            true,
            hide(visible(c.target, c.mode), false),
          );
          // A reader may keep keyboard focus on the now-hidden old frame.
          action.set(
            PDFName.of("Next"),
            doc.context.obj({
              S: "Hide",
              T: visible(c.target, c.mode).map((n) => PDFString.of(n)),
              H: false,
              Next: run(
                `HC_nav(${id},${JSON.stringify(direction)});try{this.getField(${JSON.stringify(group.hit)}).setFocus();}catch(e){}`,
              ),
            }),
          );
          c.field.set(PDFName.of("A"), action);
        }
      }
      const outsideAction = doc.context.register(
        hide(pageNames, true, hide(hitNames, false, run(`HC_outside(${id});`))),
      );
      for (const name of [...group.exits, ...group.outer]) {
        const field = records.find((r) => r.name === name)!.field;
        field.set(PDFName.of("AA"), doc.context.obj({ E: outsideAction }));
        field.set(PDFName.of("A"), outsideAction);
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
        exits: PDFRef[] = [],
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
              : name.includes("_exit_") || name.includes("_outer_")
                ? exits
                : controls
          : original
        ).push(ref);
      }
      page.node.set(
        PDFName.of("Annots"),
        doc.context.obj([
          ...original,
          ...anchors,
          ...controls,
          ...panels,
          ...exits,
        ]),
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
    controlFields: PDFRef[] = [],
    exitFields: PDFRef[] = [];
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
          : name.includes("_exit_") || name.includes("_outer_")
            ? exitFields
            : controlFields
      : originalFields
    ).push(ref);
  }
  form.acroForm.dict.set(
    PDFName.of("Fields"),
    doc.context.obj([
      ...originalFields,
      ...anchorFields,
      ...controlFields,
      ...panelFields,
      ...exitFields,
    ]),
  );
  const runtime = pdfHoverRuntime({
    rects: Object.fromEntries(
      records.map((r) => [
        r.name,
        [r.rect[0], r.rect[3], r.rect[2], r.rect[1]],
      ]),
    ),
    groups: groups.map((g) => ({
      hover: g.h,
      pinned: g.t,
      exits: g.exits,
      transit: g.transit,
      nav: g.nav,
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
  doc.setCreator(`HoverCV v${APP_VERSION}`);
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
