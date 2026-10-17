import type { PDFPageProxy } from "pdfjs-dist";
import type { Annotation } from "./schema";
import { pdfToPercent } from "./coordinates";
import { recommendPdfColor } from "./colors";

export function rasterScale(width: number, height: number, desired: number) {
  return Math.min(
    desired,
    8192 / Math.max(width, height),
    Math.sqrt(16_000_000 / (width * height)),
  );
}

// Re-render the original PDF glyphs instead of placing substitute browser text
// over them. Cropped PDF renders preserve the paper, graphics and embedded fonts.
export async function renderPdfPage(
  page: PDFPageProxy,
  scale: number,
  annotations: Annotation[],
  outputScale = 1,
  signal?: AbortSignal,
) {
  const { OPS } = await import("pdfjs-dist");
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width * outputScale);
  canvas.height = Math.ceil(viewport.height * outputScale);
  const render = async (
    target: HTMLCanvasElement,
    left = 0,
    top = 0,
    color?: string,
  ) => {
    signal?.throwIfAborted();
    const ctx = target.getContext("2d")!;
    let previous:
      | { fill: typeof ctx.fillStyle; stroke: typeof ctx.strokeStyle }
      | undefined;
    const restore = () => {
      if (!previous) return;
      ctx.fillStyle = previous.fill;
      ctx.strokeStyle = previous.stroke;
      previous = undefined;
    };
    const task = page.render({
      canvas: target,
      viewport,
      transform: [outputScale, 0, 0, outputScale, -left, -top],
      operationsFilter: color
        ? (index, list) => {
            restore();
            if (
              [
                OPS.showText,
                OPS.showSpacedText,
                OPS.nextLineShowText,
                OPS.nextLineSetSpacingShowText,
              ].includes(list.fnArray[index])
            ) {
              previous = { fill: ctx.fillStyle, stroke: ctx.strokeStyle };
              ctx.fillStyle = color;
              ctx.strokeStyle = color;
            }
            return true;
          }
        : undefined,
    });
    const cancel = () => task.cancel();
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      await task.promise;
    } finally {
      restore();
      signal?.removeEventListener("abort", cancel);
    }
  };
  await render(canvas);
  const sample = document.createElement("canvas");
  sample.width = 160;
  sample.height = 220;
  sample.getContext("2d")!.drawImage(canvas, 0, 0, 160, 220);
  const theme = recommendPdfColor(
    sample.getContext("2d")!.getImageData(0, 0, 160, 220).data,
  );
  sample.width = 0;
  const groups = new Map<string, number[][]>();
  for (const a of annotations.filter((a) => a.kind === "text")) {
    const rects = groups.get(a.color) || [];
    for (const rect of a.rects) {
      const [l, t, w, h] = pdfToPercent(rect, viewport);
      const left = Math.max(0, Math.floor((l / 100) * canvas.width));
      const top = Math.max(0, Math.floor((t / 100) * canvas.height));
      const right = Math.min(
        canvas.width,
        Math.ceil(((l + w) / 100) * canvas.width),
      );
      const bottom = Math.min(
        canvas.height,
        Math.ceil(((t + h) / 100) * canvas.height),
      );
      if (right > left && bottom > top) rects.push([left, top, right, bottom]);
    }
    groups.set(a.color, rects);
  }
  for (const [color, rects] of groups) {
    if (!rects.length) continue;
    const left = Math.min(...rects.map((r) => r[0])),
      top = Math.min(...rects.map((r) => r[1]));
    const crop = document.createElement("canvas");
    crop.width = Math.max(...rects.map((r) => r[2])) - left;
    crop.height = Math.max(...rects.map((r) => r[3])) - top;
    await render(crop, left, top, color);
    const ctx = canvas.getContext("2d")!;
    for (const [l, t, r, b] of rects)
      ctx.drawImage(crop, l - left, t - top, r - l, b - t, l, t, r - l, b - t);
    crop.width = 0;
  }
  signal?.throwIfAborted();
  return { canvas, theme };
}
