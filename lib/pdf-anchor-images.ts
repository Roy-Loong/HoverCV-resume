import type { Project, Rect } from "./schema";
import { dataToBytes } from "./schema";
import { normalizeRect, pdfToPercent } from "./coordinates";
import { rasterScale, renderPdfPage } from "./pdf-render";

export type AnchorImage = {
  bytes: Uint8Array;
  rect: Rect;
  rotation: number;
  page: number;
};

// Repaint only the selected glyph regions from the original embedded fonts.
// Ordinary image pixels work even in readers that ignore PDF blend modes.
export async function pdfAnchorImages(
  p: Project,
  signal?: AbortSignal,
): Promise<AnchorImage[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
  const task = pdfjs.getDocument({
    data: dataToBytes(p.pdfData),
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    wasmUrl: "/pdfjs/wasm/",
  });
  const output: AnchorImage[] = [];
  const abort = () => {
    void task.destroy();
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const pdf = await task.promise;
    for (let n = 1; n <= pdf.numPages; n++) {
      signal?.throwIfAborted();
      const annotations = p.annotations.filter(
        (a) => a.page === n && a.kind === "text",
      );
      if (!annotations.length) continue;
      const page = await pdf.getPage(n),
        v = page.getViewport({ scale: 1 });
      const scale = rasterScale(v.width, v.height, 6);
      const { canvas } = await renderPdfPage(
        page,
        1,
        annotations,
        scale,
        signal,
      );
      try {
        for (const a of annotations)
          for (const r of a.rects) {
            const [l, t, w, h] = pdfToPercent(r, v);
            const left = Math.max(0, Math.floor((l / 100) * v.width * scale));
            const top = Math.max(0, Math.floor((t / 100) * v.height * scale));
            const right = Math.min(
              canvas.width,
              Math.ceil(((l + w) / 100) * v.width * scale),
            );
            const bottom = Math.min(
              canvas.height,
              Math.ceil(((t + h) / 100) * v.height * scale),
            );
            if (right <= left || bottom <= top) continue;
            const crop = document.createElement("canvas");
            crop.width = right - left;
            crop.height = bottom - top;
            crop
              .getContext("2d")!
              .drawImage(
                canvas,
                left,
                top,
                crop.width,
                crop.height,
                0,
                0,
                crop.width,
                crop.height,
              );
            output.push({
              bytes: dataToBytes(crop.toDataURL("image/png")),
              rect: normalizeRect([
                ...v.convertToPdfPoint(left / scale, top / scale),
                ...v.convertToPdfPoint(right / scale, bottom / scale),
              ]),
              rotation: page.rotate,
              page: n,
            });
            crop.width = 0;
            crop.height = 0;
          }
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    }
    return output;
  } finally {
    signal?.removeEventListener("abort", abort);
    await task.destroy();
  }
}
