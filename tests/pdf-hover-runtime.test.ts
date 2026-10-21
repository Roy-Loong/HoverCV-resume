import { afterEach, describe, expect, it, vi } from "vitest";
import { createContext, runInContext } from "node:vm";
import { pdfHoverRuntime } from "../lib/pdf-hover-runtime";

function runtime(timer: "yes" | "missing" | "undefined" = "yes") {
  vi.useFakeTimers();
  const fields = new Map(
    ["h0", "h1", "t0", "t1", "word", "other", "h2", "t2"].map((n) => [
      n,
      { display: 1 },
    ]),
  );
  const config = {
    groups: [
      {
        hover: [["h0"], ["h1"]],
        pinned: [["t0"], ["t1"]],
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
    fields.get("h0")!.display = 1;
    fields.get("h1")!.display = 1;
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
    r.run("HC_keep();");
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
    "没有可用计时器（%s）时直接关闭，不卡在页面上",
    (mode) => {
      const r = runtime(mode);
      r.open();
      r.exit();
      expect(r.fields.get("h0")!.display).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it("点击固定卡片忽略指针移开，主动关闭后全部隐藏", () => {
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
