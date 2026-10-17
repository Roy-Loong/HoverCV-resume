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
}: {
  project: Project;
  zoom: number;
  tool: PdfTool;
  selected: string | null;
  onSelect: (id: string) => void;
  onAdd: (a: Annotation) => void;
  onPages: (pages: Project["pages"]) => void;
  onError: (s: string) => void;
}) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const callbacks = useRef({ onPages, onError });
  callbacks.current = { onPages, onError };
  useEffect(() => {
    let cancelled = false;
    let task:
      ReturnType<(typeof import("pdfjs-dist"))["getDocument"]> | undefined;
    (async () => {
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
      if (!project.pages.length) {
        const pages: Project["pages"] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) return;
          const p = await pdf.getPage(i);
          const base = p.getViewport({ scale: 1 });
          const vp = p.getViewport({ scale: Math.min(2, 1800 / base.width) });
          const c = document.createElement("canvas");
          c.width = Math.ceil(vp.width);
          c.height = Math.ceil(vp.height);
          await p.render({ canvas: c, viewport: vp }).promise;
          pages.push({
            width: base.width,
            height: base.height,
            image: c.toDataURL("image/jpeg", 0.88),
            view: p.view as Rect,
            rotation: p.rotate,
          });
          c.width = 0;
        }
        if (!cancelled) callbacks.current.onPages(pages);
      }
    })().catch((e) => {
      if (!cancelled)
        callbacks.current.onError(
          e instanceof Error ? e.message : "PDF 无法读取",
        );
    });
    return () => {
      cancelled = true;
      setDoc(null);
      void task?.destroy();
    };
  }, [project.id, project.pdfHash, project.pdfData]);
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
  useEffect(() => {
    let stop = false;
    let render: ReturnType<PDFPageProxy["render"]> | undefined;
    let layer: import("pdfjs-dist").TextLayer | undefined;
    setReady(false);
    (async () => {
      const pdfjs = await import("pdfjs-dist");
      const p = await doc.getPage(pageNumber);
      if (stop || !canvas.current || !text.current) return;
      page.current = p;
      const v = p.getViewport({ scale: zoom });
      setSize({ width: v.width, height: v.height });
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.current.width = Math.floor(v.width * dpr);
      canvas.current.height = Math.floor(v.height * dpr);
      render = p.render({
        canvas: canvas.current,
        viewport: v,
        transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
      });
      await render.promise;
      if (stop) return;
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
      render?.cancel();
      layer?.cancel();
    };
  }, [doc, pageNumber, zoom]);
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
        <span>PDF 原始排版 · {Math.round(zoom * 100)}%</span>
      </div>
    </div>
  );
}
