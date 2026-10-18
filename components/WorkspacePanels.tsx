"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, GripVertical } from "lucide-react";

type Side = "left" | "right";
type Preferences = {
  left: number;
  right: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
};
const DEFAULTS: Preferences = {
  left: 224,
  right: 296,
  leftCollapsed: false,
  rightCollapsed: false,
};
const STORAGE_KEY = "hovercv:layout:v1";
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

export function useWorkspacePanels() {
  const shellRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState(1440);
  const [preferences, setPreferences] = useState(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (value)
        setPreferences({
          left:
            typeof value.left === "number" && Number.isFinite(value.left)
              ? clamp(value.left, 180, 360)
              : DEFAULTS.left,
          right:
            typeof value.right === "number" && Number.isFinite(value.right)
              ? clamp(value.right, 240, 520)
              : DEFAULTS.right,
          leftCollapsed: value.leftCollapsed === true,
          rightCollapsed: value.rightCollapsed === true,
        });
    } catch {}
    setLoaded(true);
    const shell = shellRef.current;
    if (!shell) return;
    const observer = new ResizeObserver(() => setViewport(shell.clientWidth));
    observer.observe(shell);
    setViewport(shell.clientWidth);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
      } catch {}
    }, 180);
    return () => clearTimeout(timer);
  }, [preferences, loaded]);

  let left =
    viewport > 1000 && !preferences.leftCollapsed ? preferences.left : 0;
  let right =
    viewport > 760 && !preferences.rightCollapsed ? preferences.right : 0;
  const handles = viewport > 1000 ? 20 : viewport > 760 ? 10 : 0;
  const budget = viewport - 360 - handles;
  if (left + right > budget) {
    if (right) right = Math.max(240, Math.min(right, budget - left));
    if (left) left = Math.max(180, Math.min(left, budget - right));
  }
  const maximums = {
    left: Math.max(180, Math.min(360, budget - right)),
    right: Math.max(240, Math.min(520, budget - left)),
  };
  function resize(side: Side, width: number) {
    setPreferences((p) => ({
      ...p,
      [side]: clamp(
        Math.round(width),
        side === "left" ? 180 : 240,
        maximums[side],
      ),
      [`${side}Collapsed`]: false,
    }));
  }
  function toggle(side: Side) {
    setPreferences((p) => ({
      ...p,
      [`${side}Collapsed`]: !p[`${side}Collapsed`],
    }));
  }
  function openInspector() {
    setPreferences((p) =>
      p.rightCollapsed ? { ...p, rightCollapsed: false } : p,
    );
  }
  return {
    shellRef,
    preferences,
    left,
    right,
    maximums,
    resize,
    toggle,
    openInspector,
    reset: () => setPreferences(DEFAULTS),
    resetSide: (side: Side) => resize(side, DEFAULTS[side]),
    style: {
      "--left-width": `${left}px`,
      "--right-width": `${right}px`,
    } as React.CSSProperties,
    className: `${preferences.leftCollapsed ? "left-collapsed" : ""} ${preferences.rightCollapsed ? "right-collapsed" : ""}`,
  };
}

export function PanelDivider({
  side,
  width,
  max,
  collapsed,
  onResize,
  onToggle,
  onReset,
}: {
  side: Side;
  width: number;
  max: number;
  collapsed: boolean;
  onResize: (width: number) => void;
  onToggle: () => void;
  onReset: () => void;
}) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const name = side === "left" ? "左侧栏" : "注释设置";
  const pointsLeft = side === "left" ? !collapsed : collapsed;
  function finish(e: React.PointerEvent<HTMLDivElement>) {
    start.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  }
  return (
    <div
      className={`panel-divider divider-${side} ${dragging ? "dragging" : ""}`}
    >
      <div
        className="panel-resize-handle"
        role="separator"
        tabIndex={0}
        aria-label={`调整${name}宽度`}
        aria-controls={
          side === "left" ? "project-sidebar" : "annotation-inspector"
        }
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.round(width)}
        aria-valuetext={collapsed ? "已收起" : `${Math.round(width)} 像素`}
        title="左右拖动调整宽度；双击恢复默认；方向键微调"
        onDoubleClick={onReset}
        onKeyDown={(e) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
            return;
          e.preventDefault();
          if (e.key === "Home") {
            if (!collapsed) onToggle();
            return;
          }
          if (e.key === "End") {
            onResize(max);
            return;
          }
          const delta =
            (e.key === "ArrowRight" ? 1 : -1) *
            (side === "left" ? 1 : -1) *
            (e.shiftKey ? 30 : 10);
          onResize(width + delta);
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.focus();
          start.current = { x: e.clientX, width };
          setDragging(true);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!start.current) return;
          onResize(
            start.current.width +
              (e.clientX - start.current.x) * (side === "left" ? 1 : -1),
          );
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={() => {
          start.current = null;
          setDragging(false);
        }}
      >
        <GripVertical size={13} aria-hidden="true" />
      </div>
      <button
        className="panel-collapse"
        aria-label={`${collapsed ? "展开" : "收起"}${name}`}
        aria-expanded={!collapsed}
        title={`${collapsed ? "展开" : "收起"}${name}`}
        onClick={onToggle}
      >
        {pointsLeft ? <ChevronLeft size={12} /> : <ChevronRight size={12} />}
      </button>
    </div>
  );
}
