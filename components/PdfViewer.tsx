"use client";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { clientToPdf, coalesceRects, pdfToPercent } from "@/lib/coordinates";
import {
  dataToBytes,
  newAnnotation,
  type Annotation,
  type Project,
  type Rect,
} from "@/lib/schema";
import Hotspot from "./Hotspot";
import { rasterScale, renderPdfPage } from "@/lib/pdf-render";
export type PdfTool = "text" | "area" | "read";
export default function PdfViewer({
  project,
  zoom,
  tool,
  selected,
  onSelect,
  onAdd,
  onPages,
  onError,
  onRenderState,
}: {
  project: Project;
  zoom: number;
  tool: PdfTool;
  selected: string | null;
  onSelect: (id: string) => void;
  onAdd: (a: Annotation) => void;
  onPages: (pages: Project["pages"]) => void;
  onError: (s: string) => void;
  onRenderState: (rendering: boolean) => void;
}) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const callbacks = useRef({ onPages, onError, onRenderState });
  callbacks.current = { onPages, onError, onRenderState };
  const pageCache = useRef(
    new Map<number, { key: string; page: Project["pages"][number] }>(),
  );
  const appearanceKey = JSON.stringify(
    project.annotations.map(({ page, kind, rects, color }) => ({
      page,
      kind,
      rects,
      color,
    })),
  );
  useEffect(() => {
    let cancelled = false;
    let task:
      ReturnType<(typeof import("pdfjs-dist"))["getDocument"]> | undefined;
    (async () => {
      callbacks.current.onRenderState(true);
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
      task = pdfjs.getDocument({
        data: dataToBytes(project.pdfData),
        enableXfa: false,
        cMapUrl: "/pdfjs/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: "/pdfjs/standard_fonts/",
        wasmUrl: "/pdfjs/wasm/",
      });
      const pdf = await task.promise;
      if (cancelled) return;
      if (pdf.numPages > 30) throw Error("首版支持最多 30 页 PDF");
      setDoc(pdf);
    })().catch((e) => {
      if (!cancelled) {
        callbacks.current.onRenderState(false);
        callbacks.current.onError(
          e instanceof Error ? e.message : "PDF 无法读取",
        );
      }
    });
    return () => {
      cancelled = true;
      setDoc(null);
      pageCache.current.clear();
      void task?.destroy();
    };
  }, [project.id, project.pdfHash, project.pdfData]);
  useEffect(() => {
    if (!doc) return;
    const controller = new AbortController();
    callbacks.current.onRenderState(true);
    void (async () => {
      const pages: Project["pages"] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        controller.signal.throwIfAborted();
        const annotations = project.annotations.filter(
          (a) => a.page === i && a.kind === "text",
        );
        const key = JSON.stringify(
          annotations.map(({ rects, color }) => ({ rects, color })),
        );
        const cached = pageCache.current.get(i);
        if (cached?.key === key) {
          pages.push(cached.page);
          continue;
        }
        const p = await doc.getPage(i);
        const base = p.getViewport({ scale: 1 });
        const { canvas, theme } = await renderPdfPage(
          p,
          rasterScale(base.width, base.height, 3),
          annotations,
          1,
          controller.signal,
        );
        const rendered = {
          width: base.width,
          height: base.height,
          image: canvas.toDataURL("image/png"),
          view: p.view as Rect,
          rotation: p.rotate,
          themeColor: theme.color,
          hasTheme: theme.hasTheme,
        };
        canvas.width = 0;
        pages.push(rendered);
        pageCache.current.set(i, { key, page: rendered });
      }
      controller.signal.throwIfAborted();
      callbacks.current.onPages(pages);
    })()
      .catch((e) => {
        if (!controller.signal.aborted)
          callbacks.current.onError(`高清预览生成失败：${e.message}`);
      })
      .finally(() => {
        if (!controller.signal.aborted) callbacks.current.onRenderState(false);
      });
    return () => controller.abort();
  }, [doc, appearanceKey]);
  if (!doc)
    return (
      <div className="pdf-loading">
        <span className="spinner" /> 正在读取 PDF…
      </div>
    );
  return (
    <div className="pdf-stack">
      {Array.from({ length: doc.numPages }, (_, i) => (
        <PdfPage
          key={`${project.pdfHash}-${i}`}
          doc={doc}
          pageNumber={i + 1}
          zoom={zoom}
          tool={tool}
          selected={selected}
          annotations={project.annotations.filter((a) => a.page === i + 1)}
          onSelect={onSelect}
          onAdd={onAdd}
          onError={onError}
        />
      ))}
    </div>
  );
}
function PdfPage({
  doc,
  pageNumber,
  zoom,
  tool,
  annotations,
  selected,
  onSelect,
  onAdd,
  onError,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  zoom: number;
  tool: PdfTool;
  annotations: Annotation[];
  selected: string | null;
  onSelect: (id: string) => void;
  onAdd: (a: Annotation) => void;
  onError: (s: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    text = useRef<HTMLDivElement>(null),
    root = useRef<HTMLDivElement>(null),
    page = useRef<PDFPageProxy | null>(null);
  const [size, setSize] = useState({ width: 595 * zoom, height: 842 * zoom }),
    [ready, setReady] = useState(false),
    [drawing, setDrawing] = useState<{
      x: number;
      y: number;
      ex: number;
      ey: number;
    } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const appearanceKey = JSON.stringify(
    annotations
      .filter((a) => a.kind === "text")
      .map(({ rects, color }) => ({ rects, color })),
  );
  useEffect(() => {
    let stop = false;
    const controller = new AbortController();
    let layer: import("pdfjs-dist").TextLayer | undefined;
    setReady(false);
    (async () => {
      const pdfjs = await import("pdfjs-dist");
      const p = await doc.getPage(pageNumber);
      if (stop || !canvas.current || !text.current) return;
      page.current = p;
      const v = p.getViewport({ scale: zoom });
      setSize({ width: v.width, height: v.height });
      const dpr = rasterScale(
        v.width,
        v.height,
        Math.max(2, Math.min(devicePixelRatio || 1, 4)),
      );
      const rendered = await renderPdfPage(
        p,
        zoom,
        annotations,
        dpr,
        controller.signal,
      );
      if (stop || !canvas.current || !text.current) {
        rendered.canvas.width = 0;
        return;
      }
      canvas.current.width = rendered.canvas.width;
      canvas.current.height = rendered.canvas.height;
      canvas.current.getContext("2d")!.drawImage(rendered.canvas, 0, 0);
      rendered.canvas.width = 0;
      text.current.replaceChildren();
      text.current.style.setProperty("--scale-factor", String(zoom));
      text.current.style.setProperty("--total-scale-factor", String(zoom));
      layer = new pdfjs.TextLayer({
        textContentSource: await p.getTextContent(),
        container: text.current,
        viewport: v,
      });
      await layer.render();
      if (!stop) setReady(true);
    })().catch((e) => {
      if (!stop && e?.name !== "RenderingCancelledException")
        onError(String(e.message || e));
    });
    return () => {
      stop = true;
      controller.abort();
      layer?.cancel();
    };
  }, [doc, pageNumber, zoom, appearanceKey]);
  function selection() {
    if (tool !== "text" || !page.current || !root.current) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (
      !root.current.contains(range.startContainer) ||
      !root.current.contains(range.endContainer)
    ) {
      onError("跨页文字请按页分别创建注释");
      return;
    }
    const content = sel.toString().trim();
    if (!content) return;
    const box = root.current.getBoundingClientRect();
    const v = page.current.getViewport({ scale: zoom });
    const rects = coalesceRects(Array.from(range.getClientRects())).map((r) =>
      clientToPdf(r, box, v),
    );
    if (rects.length) {
      onAdd(newAnnotation(pageNumber, rects, content, "text"));
      sel.removeAllRanges();
    }
  }
  function down(e: React.PointerEvent) {
    if (tool !== "area" || !root.current) return;
    const r = root.current.getBoundingClientRect();
    start.current = { x: e.clientX - r.left, y: e.clientY - r.top };
    setDrawing({ ...start.current, ex: start.current.x, ey: start.current.y });
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent) {
    if (!start.current || !root.current) return;
    const r = root.current.getBoundingClientRect();
    setDrawing({
      ...start.current,
      ex: Math.max(0, Math.min(r.width, e.clientX - r.left)),
      ey: Math.max(0, Math.min(r.height, e.clientY - r.top)),
    });
  }
  function up() {
    if (tool === "text") {
      selection();
      return;
    }
    if (!drawing || !page.current || !root.current) {
      start.current = null;
      return;
    }
    const d = drawing,
      b = root.current.getBoundingClientRect();
    if (Math.abs(d.ex - d.x) > 6 && Math.abs(d.ey - d.y) > 6) {
      const v = page.current.getViewport({ scale: zoom });
      onAdd(
        newAnnotation(
          pageNumber,
          [
            clientToPdf(
              {
                left: b.left + Math.min(d.x, d.ex),
                top: b.top + Math.min(d.y, d.ey),
                right: b.left + Math.max(d.x, d.ex),
                bottom: b.top + Math.max(d.y, d.ey),
              },
              b,
              v,
            ),
          ],
          "",
          "area",
        ),
      );
    }
    start.current = null;
    setDrawing(null);
  }
  const viewport = page.current?.getViewport({ scale: zoom });
  return (
    <div className="page-wrap">
      <div
        className={`pdf-page tool-${tool}`}
        data-page={pageNumber}
        ref={root}
        style={{ width: size.width, height: size.height }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => {
          start.current = null;
          setDrawing(null);
        }}
      >
        <canvas
          ref={canvas}
          style={{ width: size.width, height: size.height }}
        />
        <div ref={text} className="textLayer" />
        {ready &&
          viewport &&
          annotations.map((a) =>
            a.rects.map((r, i) => {
              const [l, t, w, h] = pdfToPercent(r, viewport);
              return (
                <Hotspot
                  key={`${a.id}-${i}`}
                  annotation={a}
                  style={{
                    left: `${l}%`,
                    top: `${t}%`,
                    width: `${w}%`,
                    height: `${h}%`,
                  }}
                  selected={selected === a.id}
                  onEdit={tool === "read" ? undefined : () => onSelect(a.id)}
                  disabled={tool === "area"}
                />
              );
            }),
          )}
        {drawing && (
          <div
            className="drawing"
            style={{
              left: Math.min(drawing.x, drawing.ex),
              top: Math.min(drawing.y, drawing.ey),
              width: Math.abs(drawing.ex - drawing.x),
              height: Math.abs(drawing.ey - drawing.y),
            }}
          />
        )}
      </div>
      <div className="page-footer">
        <span>第 {pageNumber} 页</span>
        <span>高清渲染 · {Math.round(zoom * 100)}%</span>
      </div>
    </div>
  );
}
