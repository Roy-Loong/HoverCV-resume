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
import type { Annotation } from "@/lib/schema";
import CardContents from "./CardContents";
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
            <CardContents
              annotation={a}
              index={index}
              videoRef={video}
              onClose={touch.current ? () => setOpen(false) : undefined}
              onPause={setPaused}
              onIndex={(next) => {
                setPaused(true);
                video.current?.pause();
                setIndex(next);
              }}
            />
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
