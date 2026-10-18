"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PdfTool } from "./PdfViewer";

type Anchor = {
  page: HTMLElement;
  x: number;
  y: number;
  clientX: number;
  clientY: number;
  expectedWidth: number;
};
export default function CanvasViewport({
  zoom,
  tool,
  onZoom,
  onUpload,
  children,
}: {
  zoom: number;
  tool: PdfTool;
  onZoom: (zoom: number) => void;
  onUpload: (file: File) => void;
  children: React.ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const onZoomRef = useRef(onZoom);
  onZoomRef.current = onZoom;
  const anchor = useRef<Anchor | null>(null);
  const previousZoom = useRef(zoom);
  const drag = useRef<{
    pointerId: number;
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const spaceRef = useRef(false);
  const pointerInside = useRef(false);
  const [space, setSpace] = useState(false),
    [panning, setPanning] = useState(false);

  function rememberPoint(clientX: number, clientY: number, nextZoom: number) {
    const root = viewport.current;
    if (!root) return;
    const pages = Array.from(root.querySelectorAll<HTMLElement>(".pdf-page"));
    const page =
      pages.find((p) => {
        const r = p.getBoundingClientRect();
        return r.top <= clientY && r.bottom >= clientY;
      }) ||
      pages.reduce<HTMLElement | null>(
        (best, p) =>
          !best ||
          Math.abs(p.getBoundingClientRect().top - clientY) <
            Math.abs(best.getBoundingClientRect().top - clientY)
            ? p
            : best,
        null,
      );
    if (!page || !Number(page.dataset.baseWidth)) return;
    const r = page.getBoundingClientRect(),
      v = root.getBoundingClientRect();
    anchor.current = {
      page,
      x: (clientX - r.left) / r.width,
      y: (clientY - r.top) / r.height,
      clientX: clientX - v.left,
      clientY: clientY - v.top,
      expectedWidth: Number(page.dataset.baseWidth) * nextZoom,
    };
  }
  useEffect(() => {
    const root = viewport.current;
    if (!root) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta =
        e.deltaY *
        (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? root.clientHeight : 1);
      const next = Math.max(
        0.4,
        Math.min(
          2,
          Math.round(
            zoomRef.current *
              Math.exp(-Math.max(-200, Math.min(200, delta)) * 0.002) *
              100,
          ) / 100,
        ),
      );
      if (next === zoomRef.current) return;
      rememberPoint(e.clientX, e.clientY, next);
      zoomRef.current = next;
      onZoomRef.current(next);
    };
    root.addEventListener("wheel", wheel, { passive: false });
    return () => root.removeEventListener("wheel", wheel);
  }, []);
  useLayoutEffect(() => {
    if (previousZoom.current === zoom) return;
    previousZoom.current = zoom;
    const root = viewport.current;
    if (!root) return;
    if (!anchor.current) {
      const r = root.getBoundingClientRect();
      rememberPoint(
        r.left + root.clientWidth / 2,
        r.top + root.clientHeight / 2,
        zoom,
      );
    }
    const point = anchor.current;
    if (!point) return;
    point.expectedWidth = Number(point.page.dataset.baseWidth) * zoom;
    const restore = () => {
      if (!point.page.isConnected) {
        anchor.current = null;
        observer.disconnect();
        return;
      }
      const r = point.page.getBoundingClientRect();
      if (Math.abs(r.width - point.expectedWidth) > 1) return;
      const v = root.getBoundingClientRect();
      root.scrollLeft += r.left + point.x * r.width - v.left - point.clientX;
      root.scrollTop += r.top + point.y * r.height - v.top - point.clientY;
      anchor.current = null;
      observer.disconnect();
    };
    const observer = new ResizeObserver(restore);
    observer.observe(point.page);
    restore();
    return () => observer.disconnect();
  }, [zoom]);
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (
        e.code !== "Space" ||
        document.querySelector(".modal") ||
        (e.target as HTMLElement).closest(
          "input,textarea,select,a,[contenteditable=true]",
        ) ||
        ((e.target as HTMLElement).closest("button") && !pointerInside.current)
      )
        return;
      e.preventDefault();
      spaceRef.current = true;
      setSpace(true);
    };
    const reset = () => {
      spaceRef.current = false;
      setSpace(false);
    };
    const keyup = (e: KeyboardEvent) => {
      if (e.code === "Space") reset();
    };
    const blur = () => {
      reset();
      drag.current = null;
      setPanning(false);
    };
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", blur);
    };
  }, []);
  function finish(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    e.preventDefault();
    e.stopPropagation();
    drag.current = null;
    setPanning(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  }
  return (
    <div
      ref={viewport}
      className={`document-canvas ${tool === "area" ? "area-mode" : ""}`}
      data-hand-active={tool === "pan" || space || panning}
      data-panning={panning}
      onPointerEnter={() => {
        pointerInside.current = true;
      }}
      onPointerLeave={() => {
        pointerInside.current = false;
      }}
      onPointerDownCapture={(e) => {
        if (!(
          e.button === 1 ||
          ((tool === "pan" || spaceRef.current) && e.button === 0)
        ))
          return;
        const root = e.currentTarget,
          r = root.getBoundingClientRect();
        if (
          e.clientX >= r.left + root.clientWidth ||
          e.clientY >= r.top + root.clientHeight
        )
          return;
        e.preventDefault();
        e.stopPropagation();
        window.getSelection()?.removeAllRanges();
        drag.current = {
          pointerId: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          left: root.scrollLeft,
          top: root.scrollTop,
        };
        root.setPointerCapture(e.pointerId);
        setPanning(true);
      }}
      onPointerMoveCapture={(e) => {
        const d = drag.current;
        if (!d || e.pointerId !== d.pointerId) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.scrollLeft = d.left - (e.clientX - d.x);
        e.currentTarget.scrollTop = d.top - (e.clientY - d.y);
      }}
      onPointerUpCapture={finish}
      onPointerCancelCapture={finish}
      onLostPointerCapture={() => {
        drag.current = null;
        setPanning(false);
      }}
      onClickCapture={(e) => {
        if (tool === "pan" || spaceRef.current) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file?.type === "application/pdf") onUpload(file);
      }}
    >
      {children}
    </div>
  );
}
