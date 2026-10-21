"use client";
import { useEffect, useId, useRef, useState } from "react";
import {
  useFloating,
  offset,
  flip,
  shift,
  size,
  autoUpdate,
  useHover,
  useFocus,
  useDismiss,
  useInteractions,
  safePolygon,
  FloatingPortal,
} from "@floating-ui/react";
import {
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  X,
  FileText,
} from "lucide-react";
import type { Annotation } from "@/lib/schema";
import ImageFrame from "./ImageFrame";
import { HOVER_OPEN_MS, HOVER_CLOSE_MS, SLIDESHOW_MS } from "@/lib/reader";
import { HOVER_CARD_WIDTH, HOVER_CARD_HEIGHT } from "@/lib/card-layout";
export default function Hotspot({
  annotation: a,
  style,
  selected,
  onEdit,
  disabled,
}: {
  annotation: Annotation;
  style: React.CSSProperties;
  selected: boolean;
  onEdit?: () => void;
  disabled?: boolean;
}) {
  const instanceId = useId();
  const [open, setOpen] = useState(false),
    [index, setIndex] = useState(0),
    [paused, setPaused] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const touch = useRef(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange(v) {
      if (!v && document.fullscreenElement) return;
      if (v)
        window.dispatchEvent(
          new CustomEvent("hovercv:card-open", { detail: instanceId }),
        );
      setOpen(v);
    },
    placement: "right-start",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(14),
      flip(),
      shift({ padding: 12 }),
      size({
        padding: 12,
        apply({ availableHeight, elements }) {
          elements.floating.style.maxHeight = `${Math.min(HOVER_CARD_HEIGHT, availableHeight)}px`;
        },
      }),
    ],
  });
  const hover = useHover(context, {
      mouseOnly: true,
      delay: { open: HOVER_OPEN_MS, close: HOVER_CLOSE_MS },
      handleClose: safePolygon({ buffer: 8, requireIntent: false }),
      move: false,
    }),
    focus = useFocus(context),
    dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    focus,
    dismiss,
  ]);
  useEffect(() => {
    const onOther = (e: Event) => {
      if ((e as CustomEvent).detail !== instanceId) setOpen(false);
    };
    window.addEventListener("hovercv:card-open", onOther);
    return () => window.removeEventListener("hovercv:card-open", onOther);
  }, [instanceId]);
  useEffect(() => {
    if (!open) {
      video.current?.pause();
      setIndex(0);
    }
  }, [open]);
  useEffect(() => {
    if (!open || !a.autoplay || paused || a.media.length < 2) return;
    const id = setInterval(() => {
      video.current?.pause();
      setIndex((i) => (i + 1) % a.media.length);
    }, SLIDESHOW_MS);
    return () => clearInterval(id);
  }, [open, a.autoplay, a.media.length, paused]);
  useEffect(() => {
    const element = video.current;
    return () => element?.pause();
  }, [index, open]);
  const media = a.media[index];
  const mediaBlock = media && (
    <div className="card-media">
      {media.type === "image" ? (
        <ImageFrame media={media} />
      ) : (
        <div className="media-viewport">
          <video
            ref={video}
            src={media.src}
            controls
            playsInline
            preload="metadata"
            onPointerEnter={() => setPaused(true)}
          />
        </div>
      )}
      <div className="media-caption">{media.caption || "作品展示"}</div>
      <div
        className="media-controls"
        onPointerEnter={() => setPaused(true)}
        onPointerLeave={() => setPaused(false)}
      >
        <button
          aria-label="上一张"
          onClick={() => {
            setPaused(true);
            video.current?.pause();
            setIndex((index - 1 + a.media.length) % a.media.length);
          }}
        >
          <ChevronLeft size={15} />
        </button>
        <span>
          {String(index + 1).padStart(2, "0")}{" "}
          <i>/ {String(a.media.length).padStart(2, "0")}</i>
        </span>
        <button
          aria-label="下一张"
          onClick={() => {
            setPaused(true);
            video.current?.pause();
            setIndex((index + 1) % a.media.length);
          }}
        >
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
  return (
    <>
      <button
        ref={refs.setReference}
        {...getReferenceProps({
          onPointerDown: (e) => {
            touch.current = e.pointerType === "touch";
          },
          onClick: (e) => {
            if (touch.current)
              context.onOpenChange(true, e.nativeEvent, "click");
            else {
              window.dispatchEvent(
                new CustomEvent("hovercv:card-open", { detail: instanceId }),
              );
              setOpen(true);
            }
            onEdit?.();
          },
        })}
        disabled={disabled}
        aria-label={a.title || "区域注释"}
        className={`hotspot ${a.kind} ${selected ? "selected" : ""}`}
        style={{ ...style, "--accent": a.color } as React.CSSProperties}
      />
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            {...getFloatingProps({
              onFocus: () => setPaused(true),
              onBlur: () => setPaused(false),
            })}
            role="dialog"
            aria-label={a.title}
            style={{
              ...floatingStyles,
              width: HOVER_CARD_WIDTH,
              height: HOVER_CARD_HEIGHT,
            }}
            className={`hover-card template-${a.template}`}
          >
            <div className="card-topline" style={{ background: a.color }} />
            <button
              className="card-close icon-btn"
              aria-label="关闭注释"
              onClick={() => setOpen(false)}
            >
              <X size={15} />
            </button>
            <div className="card-content">
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
            <div className="card-credit">
              补充内容由简历作者提供 <span>HoverCV</span>
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
