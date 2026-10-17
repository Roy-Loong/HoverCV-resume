import { describe, expect, it } from "vitest";
import { EditHistory } from "../lib/edit-history";
import { recommendPdfColor } from "../lib/colors";
import { rasterScale } from "../lib/pdf-render";

describe("编辑撤销历史", () => {
  it("合并连续输入，同时保留新增和删除的独立撤销边界", () => {
    const history = new EditHistory<string>();
    history.record("empty", "", 0);
    history.record("new", "body", 100);
    history.record("typing-1", "body", 200);
    expect(history.undo("typing-2")).toBe("new");
    expect(history.undo("new")).toBe("empty");
    expect(history.redo("empty")).toBe("new");
    expect(history.redo("new")).toBe("typing-2");
    history.record("typing-2", "", 400);
    expect(history.undo("deleted")).toBe("typing-2");
  });
  it("撤销后的新操作清空重做，切换项目清空历史", () => {
    const history = new EditHistory<number>();
    history.record(1);
    history.record(2);
    expect(history.undo(3)).toBe(2);
    history.record(2);
    expect(history.redo(4)).toBeUndefined();
    history.clear();
    expect(history.counts).toEqual({ undo: 0, redo: 0 });
  });
  it("限制历史长度，避免无限保留媒体引用", () => {
    const history = new EditHistory<number>(2);
    for (const n of [1, 2, 3]) history.record(n);
    expect(history.undo(4)).toBe(3);
    expect(history.undo(3)).toBe(2);
    expect(history.undo(2)).toBeUndefined();
  });
});

describe("高清渲染与推荐色", () => {
  it("常规页面保留 3 倍像素，超大页面受显存预算限制", () => {
    expect(rasterScale(595, 842, 3)).toBe(3);
    const scale = rasterScale(30000, 30000, 4);
    expect(30000 * 30000 * scale * scale).toBeLessThanOrEqual(16_000_001);
  });
  it("忽略纸张和黑色正文，保留蓝色主题的色相", () => {
    const pixels = [
      255, 255, 255, 255, 0, 0, 0, 255, 30, 75, 170, 255, 32, 78, 172, 255,
    ];
    const result = recommendPdfColor(pixels);
    expect(result.hasTheme).toBe(true);
    expect(result.color).toMatch(/^#[a-f0-9]{6}$/);
    const values = result.color
      .slice(1)
      .match(/../g)!
      .map((n) => parseInt(n, 16));
    expect(values[2]).toBeGreaterThan(values[0]);
    expect(
      recommendPdfColor([255, 255, 255, 255, 30, 30, 30, 255]).hasTheme,
    ).toBe(false);
  });
});
