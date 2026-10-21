import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { toCanvas } from "html-to-image";
import CardContents from "../components/CardContents";
import type { Annotation } from "./schema";
import { HOVER_CARD_WIDTH, HOVER_CARD_HEIGHT } from "./card-layout";

export type CardControl = {
  rect: number[];
  action: string;
  target?: number;
  url?: string;
  label: string;
};
export type CardFrame = {
  image: Uint8Array;
  format: "png" | "jpeg";
  controls: CardControl[];
  text: string;
};

/** Capture the same markup/CSS the user edits, at 3× resolution. Only the
 * card is rasterized: the original resume remains its original vector PDF. */
export async function renderPdfCards(
  a: Annotation,
  signal?: AbortSignal,
): Promise<CardFrame[]> {
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;left:-10000px;top:0;pointer-events:none;";
  host.setAttribute("aria-hidden", "true");
  host.inert = true;
  document.body.append(host);
  const root = createRoot(host);
  const frames: (CardFrame & { media: number; offset: number })[] = [];
  const settle = () =>
    new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  const render = (index: number, scroll?: { top: number; max: number }) =>
    flushSync(() =>
      root.render(
        <div
          className={`hover-card template-${a.template}`}
          style={{
            position: "relative",
            width: HOVER_CARD_WIDTH,
            height: HOVER_CARD_HEIGHT,
            maxWidth: "none",
            maxHeight: "none",
            boxShadow: "none",
          }}
        >
          <CardContents annotation={a} index={index} exportScroll={scroll} />
        </div>,
      ),
    );
  try {
    await document.fonts.ready;
    for (let index = 0; index < Math.max(1, a.media.length); index++) {
      signal?.throwIfAborted();
      render(index);
      await Promise.all(
        [...host.querySelectorAll("img")].map((img) =>
          img.decode().catch(() => {
            throw Error("有图片无法读取，请替换该图片后重试。");
          }),
        ),
      );
      await settle();
      const content = host.querySelector<HTMLElement>(".card-content")!;
      const inner = host.querySelector<HTMLElement>(".card-content-inner")!;
      const width = inner.getBoundingClientRect().width;
      const max = Math.max(0, content.scrollHeight - content.clientHeight);
      const step = Math.max(48, content.clientHeight - 48);
      const offsets = [0];
      while (offsets.at(-1)! < max)
        offsets.push(Math.min(max, offsets.at(-1)! + step));
      for (const offset of offsets) {
        signal?.throwIfAborted();
        render(index, { top: offset, max });
        const card = host.querySelector<HTMLElement>(".hover-card")!;
        // Preserve the web text wrapping even on systems with classic scrollbars.
        host.querySelector<HTMLElement>(".card-content-inner")!.style.width =
          `${width}px`;
        const bounds = card.getBoundingClientRect();
        const viewport = content.getBoundingClientRect();
        const controls: CardControl[] = [];
        for (const element of card.querySelectorAll<HTMLElement>(
          "[data-card-action],a[href]",
        )) {
          if (element instanceof HTMLButtonElement && element.disabled)
            continue;
          const b = element.getBoundingClientRect();
          const visible = content.contains(element) ? viewport : bounds;
          const left = Math.max(b.left, visible.left),
            top = Math.max(b.top, visible.top);
          const right = Math.min(b.right, visible.right),
            bottom = Math.min(b.bottom, visible.bottom);
          if (right - left < 1 || bottom - top < 1) continue;
          controls.push({
            rect: [
              left - bounds.left,
              top - bounds.top,
              right - bounds.left,
              bottom - bounds.top,
            ],
            action: element.dataset.cardAction || "link",
            url:
              element instanceof HTMLAnchorElement ? element.href : undefined,
            label:
              element.getAttribute("aria-label") ||
              element.textContent ||
              "链接",
          });
        }
        const canvas = await toCanvas(card, {
          pixelRatio: 3,
          width: HOVER_CARD_WIDTH,
          height: HOVER_CARD_HEIGHT,
          skipFonts: true,
          backgroundColor: "white",
        });
        signal?.throwIfAborted();
        // JPEG saves space for photos; PNG can be smaller for diagrams and
        // text. Choose the smaller encoding without changing 3x resolution.
        const encode = (format: "png" | "jpeg") =>
          new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (b) =>
                b ? resolve(b) : reject(Error("注释卡片生成失败，请重试。")),
              `image/${format}`,
              0.92,
            ),
          );
        const png = await encode("png");
        const jpeg = a.media[index] ? await encode("jpeg") : undefined;
        const format = jpeg && jpeg.size < png.size ? "jpeg" : "png";
        const blob = format === "jpeg" ? jpeg! : png;
        canvas.width = 0;
        canvas.height = 0;
        frames.push({
          image: new Uint8Array(await blob.arrayBuffer()),
          format,
          controls,
          media: index,
          offset,
          text: [
            a.title,
            a.body,
            a.media[index]?.caption ?? "",
            ...a.links.map((l) => l.label),
            ...a.citations.map((c) => c.title),
          ].join("\n"),
        });
      }
    }
    for (const frame of frames)
      for (const control of frame.controls) {
        const mediaCount = Math.max(1, a.media.length);
        const desired =
          control.action === "prev"
            ? (frame.media - 1 + mediaCount) % mediaCount
            : control.action === "next"
              ? (frame.media + 1) % mediaCount
              : frame.media;
        const candidates = frames
          .map((f, i) => ({ ...f, i }))
          .filter((f) => f.media === desired);
        if (control.action === "up")
          control.target = candidates
            .filter((f) => f.offset < frame.offset)
            .at(-1)?.i;
        else if (control.action === "down")
          control.target = candidates.find((f) => f.offset > frame.offset)?.i;
        else if (control.action === "prev" || control.action === "next")
          control.target = candidates.reduce((best, f) =>
            Math.abs(f.offset - frame.offset) <
            Math.abs(best.offset - frame.offset)
              ? f
              : best,
          ).i;
      }
    return frames;
  } finally {
    root.unmount();
    host.remove();
  }
}
