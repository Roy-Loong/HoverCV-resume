"use client";
import { useRef } from "react";
import { Check, RotateCcw } from "lucide-react";
import type { ImageLayout, Media } from "@/lib/schema";
import { DEFAULT_IMAGE_LAYOUT, imageLayout } from "@/lib/media-layout";
import ImageFrame from "./ImageFrame";

export default function ImageSettings({
  media,
  onChange,
  onDone,
}: {
  media: Media;
  onChange: (layout: ImageLayout) => void;
  onDone: () => void;
}) {
  const layout = imageLayout(media);
  const drag = useRef<{
    pointer: number;
    x: number;
    y: number;
    spaceX: number;
    spaceY: number;
    layout: ImageLayout;
  } | null>(null);
  const mode = layout.height === "auto" ? "auto" : layout.fit;
  const change = (values: Partial<ImageLayout>) =>
    onChange({ ...layout, ...values });
  return (
    <>
      <h2>调整照片展示</h2>
      <p className="modal-description">
        默认展示原图比例。放大后可拖动照片，或用滑块调整想展示的位置。
      </p>
      <div className="image-settings-grid">
        <div className="image-settings-preview">
          <ImageFrame
            media={media}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              const img = e.currentTarget.querySelector("img")!;
              if (!img.naturalWidth) return;
              const { width, height } = e.currentTarget.getBoundingClientRect();
              const ratio =
                layout.height === "auto"
                  ? width / img.naturalWidth
                  : Math[layout.fit === "cover" ? "max" : "min"](
                      width / img.naturalWidth,
                      height / img.naturalHeight,
                    );
              drag.current = {
                pointer: e.pointerId,
                x: e.clientX,
                y: e.clientY,
                spaceX: width - img.naturalWidth * ratio * layout.zoom,
                spaceY: height - img.naturalHeight * ratio * layout.zoom,
                layout,
              };
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const start = drag.current;
              if (!start || start.pointer !== e.pointerId) return;
              const position = (value: number, delta: number, space: number) =>
                Math.abs(space) < 1
                  ? value
                  : Math.round(
                      Math.max(
                        0,
                        Math.min(100, value + (delta / space) * 100),
                      ) * 10,
                    ) / 10;
              onChange({
                ...start.layout,
                x: position(start.layout.x, e.clientX - start.x, start.spaceX),
                y: position(start.layout.y, e.clientY - start.y, start.spaceY),
              });
            }}
            onPointerUp={(e) => {
              drag.current = null;
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
            onLostPointerCapture={() => {
              drag.current = null;
            }}
          />
          <span>拖动照片调整位置 · 长图可在此区域滚动查看</span>
        </div>
        <div className="image-settings-controls">
          <div
            className="image-display-modes"
            role="group"
            aria-label="图片显示方式"
          >
            {(
              [
                ["auto", "原图比例"],
                ["contain", "完整显示"],
                ["cover", "铺满裁切"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={mode === value ? "selected" : ""}
                aria-pressed={mode === value}
                onClick={() =>
                  change({
                    zoom: 1,
                    x: 50,
                    y: 50,
                    fit: value === "cover" ? "cover" : "contain",
                    height:
                      value === "auto"
                        ? "auto"
                        : typeof layout.height === "number"
                          ? layout.height
                          : 200,
                  })
                }
              >
                {label}
              </button>
            ))}
          </div>
          <label className="image-setting-range">
            <span>
              图片缩放 <output>{Math.round(layout.zoom * 100)}%</output>
            </span>
            <input
              type="range"
              aria-label="图片缩放"
              min="50"
              max="300"
              step="5"
              value={Math.round(layout.zoom * 100)}
              onChange={(e) => change({ zoom: Number(e.target.value) / 100 })}
            />
          </label>
          <label className="image-setting-range">
            <span>
              上下位置 <output>{Math.round(layout.y)}%</output>
            </span>
            <input
              type="range"
              aria-label="图片上下位置"
              min="0"
              max="100"
              step="1"
              value={layout.y}
              onChange={(e) => change({ y: Number(e.target.value) })}
            />
            <small>
              <span>顶部</span>
              <span>底部</span>
            </small>
          </label>
          <label className="image-setting-range">
            <span>
              左右位置 <output>{Math.round(layout.x)}%</output>
            </span>
            <input
              type="range"
              aria-label="图片左右位置"
              min="0"
              max="100"
              step="1"
              value={layout.x}
              onChange={(e) => change({ x: Number(e.target.value) })}
            />
          </label>
          {layout.height !== "auto" && (
            <label className="image-setting-range">
              <span>
                显示高度 <output>{layout.height} px</output>
              </span>
              <input
                type="range"
                aria-label="图片显示高度"
                min="100"
                max="480"
                step="10"
                value={layout.height}
                onChange={(e) => change({ height: Number(e.target.value) })}
              />
            </label>
          )}
          <p className="image-settings-tip">
            “原图比例”不裁切；“完整显示”将整张照片放入指定高度。放大后，可以移动照片选择展示区域。
          </p>
        </div>
      </div>
      <div className="image-settings-footer">
        <button
          className="btn btn-secondary"
          onClick={() => onChange({ ...DEFAULT_IMAGE_LAYOUT })}
        >
          <RotateCcw size={14} />
          恢复原图
        </button>
        <button className="btn btn-primary" onClick={onDone}>
          <Check size={14} />
          完成
        </button>
      </div>
      <p className="image-settings-tip">
        调整自动保存，并同步到预览和导出文件。原始照片保持完整。
      </p>
    </>
  );
}
