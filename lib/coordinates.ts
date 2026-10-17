import type { Rect } from "./schema";
export interface Viewport {
  width: number;
  height: number;
  convertToPdfPoint(x: number, y: number): number[];
  convertToViewportPoint(x: number, y: number): number[];
}
export function normalizeRect(r: number[]): Rect {
  return [
    Math.min(r[0], r[2]),
    Math.min(r[1], r[3]),
    Math.max(r[0], r[2]),
    Math.max(r[1], r[3]),
  ];
}
export function clientToPdf(
  r: { left: number; top: number; right: number; bottom: number },
  page: { left: number; top: number; width: number; height: number },
  v: Viewport,
): Rect {
  const sx = v.width / page.width,
    sy = v.height / page.height;
  return normalizeRect([
    ...v.convertToPdfPoint((r.left - page.left) * sx, (r.top - page.top) * sy),
    ...v.convertToPdfPoint(
      (r.right - page.left) * sx,
      (r.bottom - page.top) * sy,
    ),
  ]);
}
export function pdfToPercent(rect: Rect, v: Viewport): Rect {
  const r = normalizeRect([
    ...v.convertToViewportPoint(rect[0], rect[1]),
    ...v.convertToViewportPoint(rect[2], rect[3]),
  ]);
  return [
    (r[0] / v.width) * 100,
    (r[1] / v.height) * 100,
    ((r[2] - r[0]) / v.width) * 100,
    ((r[3] - r[1]) / v.height) * 100,
  ];
}
export function coalesceRects(rects: DOMRect[]) {
  const visible = rects.filter((r) => r.width > 1 && r.height > 1);
  // A fully selected text span contributes both its element box and its text box.
  // Keep the containing text box, without joining separate lines or disjoint runs.
  return visible.filter(
    (r, i) =>
      !visible.some(
        (q, j) =>
          j !== i &&
          q.left <= r.left + 0.75 &&
          q.top <= r.top + 0.75 &&
          q.right >= r.right - 0.75 &&
          q.bottom >= r.bottom - 0.75 &&
          (q.width * q.height > r.width * r.height + 1 ||
            (Math.abs(q.width * q.height - r.width * r.height) <= 1 && j < i)),
      ),
  );
}
