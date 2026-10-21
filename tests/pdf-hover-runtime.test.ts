import { afterEach, describe, expect, it, vi } from "vitest";
import { createContext, runInContext } from "node:vm";
import { pdfHoverRuntime } from "../lib/pdf-hover-runtime";

function runtime(timer: "yes" | "missing" | "undefined" = "yes") {
  vi.useFakeTimers();
  const fields = new Map(
    ["h0", "h1", "t0", "t1", "word", "other", "h2", "t2", "outside"].map(
      (n) => [n, { display: 1 }],
    ),
  );
  const config = {
    groups: [
      {
        hover: [["h0"], ["h1"]],
        pinned: [["t0"], ["t1"]],
        exits: ["outside"],
        hit: "word",
        page: 0,
      },
      { hover: [["h2"]], pinned: [["t2"]], hit: "other", page: 0 },
    ],
  };
  const context = createContext({
    getField: (name: string) => fields.get(name),
    display: { hidden: 1, noPrint: 2 },
    app: {
      clearTimeOut: clearTimeout,
      setTimeOut: (script: string, ms: number) => {
        if (timer === "missing") throw Error("unsupported timer");
        if (timer === "undefined") return;
        return setTimeout(() => runInContext(script, context), ms);
      },
    },
  });
  const script = pdfHoverRuntime(config),
    run = (s: string) => runInContext(s, context);
  run(script);
  const open = (frame = 0, pin = false) => {
    fields.get(pin ? `t${frame}` : `h${frame}`)!.display = 2;
    run(`HC_open(0,${frame},${pin});`);
  };
  const exit = (oldFrame = 0) => {
    run(`HC_leave(0,${oldFrame});`);
  };
  return { run, fields, open, exit, script, context };
}
afterEach(() => vi.useRealTimers());
describe("PDF 悬停与点击状态", () => {
  it("没有文档初始化也可由事件引导启动，249 ms 保持、250 ms 关闭并恢复词语触发区", () => {
    const r = runtime();
    r.open();
    expect(r.fields.get("other")!.display).toBe(1);
    r.exit();
    vi.advanceTimersByTime(249);
    expect(r.fields.get("h0")!.display).toBe(2);
    vi.advanceTimersByTime(1);
    expect(r.fields.get("h0")!.display).toBe(1);
    expect(r.fields.get("word")!.display).toBe(2);
    expect(r.fields.get("other")!.display).toBe(2);
  });
  it("进入卡片取消关闭，重新初始化不重置当前状态，离开仍按 250 ms 关闭", () => {
    const r = runtime();
    r.open();
    r.exit();
    vi.advanceTimersByTime(220);
    r.run(r.script);
    r.run("HC_enter(0);");
    vi.advanceTimersByTime(1000);
    expect(r.fields.get("h0")!.display).toBe(2);
    r.exit();
    vi.advanceTimersByTime(250);
    expect(r.fields.get("h0")!.display).toBe(1);
  });
  it("翻图后旧控件的迟到退出不关闭新图，离开新图才开始计时", () => {
    const r = runtime();
    r.open(1);
    r.exit(0);
    expect(r.fields.get("h0")!.display).toBe(1);
    expect(r.fields.get("h1")!.display).toBe(2);
    vi.advanceTimersByTime(1000);
    expect(r.fields.get("h1")!.display).toBe(2);
    r.exit(1);
    vi.advanceTimersByTime(250);
    expect(r.fields.get("h1")!.display).toBe(1);
  });
  it.each(["missing", "undefined"] as const)(
    "没有可用计时器（%s）时跨入卡片不关闭，离开阅读区域才关闭",
    (mode) => {
      const r = runtime(mode);
      r.open();
      r.exit();
      expect(r.fields.get("h0")!.display).toBe(2);
      r.fields.get("h0")!.display = 1; // Native outside guard
      r.run("HC_outside(0);");
      expect(r.fields.get("h0")!.display).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it("点击卡片后内部移动不会关闭，关闭时恢复文字触发区", () => {
    const r = runtime();
    r.open(1, true);
    r.exit();
    vi.advanceTimersByTime(1000);
    expect(r.fields.get("t1")!.display).toBe(2);
    expect(r.fields.get("other")!.display).toBe(1);
    expect(r.fields.get("word")!.display).toBe(2);
    r.run("HC_hide();");
    expect([...r.fields.values()].filter((f) => f.display === 2)).toHaveLength(
      2,
    );
  });
  it("离开整个阅读区域保留 249 ms，第 250 ms 自动关闭，无需点击关闭按钮", () => {
    const r = runtime();
    r.open(1, true);
    r.fields.get("t1")!.display = 1;
    r.fields.get("outside")!.display = 1;
    r.run("HC_outside(0);");
    expect(r.fields.get("t1")!.display).toBe(2);
    vi.advanceTimersByTime(249);
    expect(r.fields.get("t1")!.display).toBe(2);
    vi.advanceTimersByTime(1);
    expect(r.fields.get("t1")!.display).toBe(1);
    expect(r.fields.get("other")!.display).toBe(2);
  });
  it("从区域外重新进入视觉面板取消计时，保留当前图片与点击状态", () => {
    const r = runtime();
    r.open(1, true);
    r.fields.get("t1")!.display = 1;
    r.fields.get("outside")!.display = 1;
    r.run("HC_outside(0);");
    vi.advanceTimersByTime(200);
    r.run("HC_enter(0);");
    vi.advanceTimersByTime(1000);
    expect(r.fields.get("t1")!.display).toBe(2);
    expect(r.fields.get("outside")!.display).toBe(2);
    expect(r.context.HC_frame).toBe(1);
    expect(r.context.HC_pinned).toBe(true);
    expect(r.fields.get("h0")!.display).toBe(1);
  });
  it("进入卡片后即使阅读器执行已取消的旧回调，也不会误关当前卡片", () => {
    const r = runtime();
    r.open();
    r.exit();
    const oldGeneration = r.context.HC_generation;
    vi.advanceTimersByTime(220);
    r.run("HC_open(0,0,false);");
    r.run(`HC_expire(${oldGeneration});`);
    vi.advanceTimersByTime(1000);
    expect(r.fields.get("h0")!.display).toBe(2);
    r.exit();
    vi.advanceTimersByTime(250);
    expect(r.fields.get("h0")!.display).toBe(1);
  });
});
