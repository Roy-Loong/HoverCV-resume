"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import {
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  X,
  FileText,
} from "lucide-react";
import type { Annotation } from "@/lib/schema";
import ImageFrame from "./ImageFrame";

/** One card markup and stylesheet for the editor and PDF appearances. */
export default function CardContents({
  annotation: a,
  index,
  onIndex,
  onClose,
  onPause,
  videoRef,
  exportScroll,
}: {
  annotation: Annotation;
  index: number;
  onIndex?: (index: number) => void;
  onClose?: () => void;
  onPause?: (paused: boolean) => void;
  videoRef?: RefObject<HTMLVideoElement | null>;
  exportScroll?: { top: number; max: number };
}) {
  const content = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ top: 0, max: 0 });
  useEffect(() => {
    const element = content.current!;
    const update = () =>
      setScroll({
        top: element.scrollTop,
        max: Math.max(0, element.scrollHeight - element.clientHeight),
      });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    observer.observe(element.firstElementChild!);
    element.addEventListener("scroll", update);
    update();
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", update);
    };
  }, [a, index]);
  const position = exportScroll ?? scroll;
  const media = a.media[index];
  const mediaBlock = media && (
    <div className="card-media">
      {media.type === "image" ? (
        <ImageFrame media={media} />
      ) : (
        <div className="media-viewport">
          <video
            ref={videoRef}
            src={media.src}
            controls
            playsInline
            preload="metadata"
            onPointerEnter={() => onPause?.(true)}
          />
        </div>
      )}
      <div className="media-caption">{media.caption || "作品展示"}</div>
    </div>
  );
  return (
    <>
      <div className="card-topline" style={{ background: a.color }} />
      {onClose && (
        <button
          className="card-close icon-btn"
          aria-label="关闭注释"
          data-card-action="close"
          onClick={onClose}
        >
          <X size={15} />
        </button>
      )}
      <div
        className="card-content"
        ref={content}
        style={exportScroll ? { overflow: "hidden" } : undefined}
      >
        <div
          className="card-content-inner"
          style={
            exportScroll
              ? { transform: `translateY(-${exportScroll.top}px)` }
              : undefined
          }
        >
          <span className="eyebrow">
            <FileText size={11} /> BEYOND THE RESUME
          </span>
          <h2>{a.title || "补充故事"}</h2>
          {a.template !== "intro" && mediaBlock}
          <p className="card-body">
            {a.body || "在右侧添加补充说明，让这段经历更立体。"}
          </p>
          {a.template === "intro" && mediaBlock}
          {a.links.map((l, i) => (
            <a
              className="card-link"
              key={i}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {l.label || "访问链接"}
              <ArrowUpRight size={14} />
            </a>
          ))}
          {a.citations.length > 0 && (
            <div className="citations">
              资料来源 · {a.searchedAt?.slice(0, 10)}
              {a.citations.map((l, i) => (
                <a
                  key={i}
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {l.title}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="card-credit">
        <span>HoverCV</span>
        {a.media.length > 1 && (
          <div
            className="media-controls card-page-controls"
            onPointerEnter={() => onPause?.(true)}
            onPointerLeave={() => onPause?.(false)}
          >
            <button
              aria-label="上一张"
              data-card-action="prev"
              onClick={() =>
                onIndex?.((index - 1 + a.media.length) % a.media.length)
              }
            >
              <ChevronLeft size={15} />
            </button>
            <span>
              {String(index + 1).padStart(2, "0")} /{" "}
              {String(a.media.length).padStart(2, "0")}
            </span>
            <button
              aria-label="下一张"
              data-card-action="next"
              onClick={() => onIndex?.((index + 1) % a.media.length)}
            >
              <ChevronRight size={15} />
            </button>
          </div>
        )}
        {position.max > 1 ? (
          <div className="card-page-controls">
            <button
              aria-label="向上阅读"
              data-card-action="up"
              disabled={position.top <= 0}
              onClick={() =>
                content.current?.scrollBy({
                  top: -(content.current.clientHeight - 48),
                  behavior: "instant",
                })
              }
            >
              <ArrowUp size={15} />
            </button>
            <button
              aria-label="向下阅读"
              data-card-action="down"
              disabled={position.top >= position.max - 1}
              onClick={() =>
                content.current?.scrollBy({
                  top: content.current.clientHeight - 48,
                  behavior: "instant",
                })
              }
            >
              <ArrowDown size={15} />
            </button>
          </div>
        ) : (
          <small>简历作者提供</small>
        )}
      </div>
    </>
  );
}
