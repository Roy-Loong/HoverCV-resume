import { test, expect, type Page } from "@playwright/test";

async function ready(page: Page) {
  await page.goto("/");
  await expect(page.locator(".save-status")).toContainText("已保存至本地");
  await expect(page.locator(".hotspot")).toHaveCount(3);
}
async function dragDivider(page: Page, name: string, delta: number) {
  const r = (await page.getByRole("separator", { name }).boundingBox())!;
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width / 2 + delta, r.y + r.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
}

test("紧凑编辑区、双侧真实拖动、布局记忆、键盘与窄屏恢复", async ({ page }) => {
  await ready(page);
  expect(
    (await page.locator(".workspace-heading").boundingBox())!.height,
  ).toBeLessThanOrEqual(60);
  expect(
    (await page.locator(".document-canvas").boundingBox())!.y,
  ).toBeLessThanOrEqual(180);
  expect(
    (await page.locator(".pdf-page").boundingBox())!.y,
  ).toBeLessThanOrEqual(215);
  await dragDivider(page, "调整左侧栏宽度", 70);
  await dragDivider(page, "调整注释设置宽度", -80);
  await expect(
    page.getByRole("separator", { name: "调整左侧栏宽度" }),
  ).toHaveAttribute("aria-valuenow", "294");
  await expect(
    page.getByRole("separator", { name: "调整注释设置宽度" }),
  ).toHaveAttribute("aria-valuenow", "376");
  expect(
    (await page.locator(".workspace").boundingBox())!.width,
  ).toBeGreaterThanOrEqual(360);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("hovercv:layout:v1") || "{}").left,
      ),
    )
    .toBe(294);
  await page.reload();
  await expect(
    page.getByRole("separator", { name: "调整左侧栏宽度" }),
  ).toHaveAttribute("aria-valuenow", "294");
  await expect(
    page.getByRole("separator", { name: "调整注释设置宽度" }),
  ).toHaveAttribute("aria-valuenow", "376");
  const left = page.getByRole("separator", { name: "调整左侧栏宽度" });
  await left.focus();
  await page.keyboard.press("ArrowRight");
  await expect(left).toHaveAttribute("aria-valuenow", "304");
  await page.keyboard.press("Home");
  await expect(page.locator(".sidebar")).toBeHidden();
  await page.keyboard.press("End");
  await expect(left).toHaveAttribute("aria-valuenow", "360");
  await left.dblclick();
  await expect(left).toHaveAttribute("aria-valuenow", "224");
  await page.getByRole("button", { name: "收起左侧栏", exact: true }).click();
  await page.getByRole("button", { name: "收起注释设置", exact: true }).click();
  expect(
    (await page.locator(".workspace").boundingBox())!.width,
  ).toBeGreaterThan(1400);
  await page.setViewportSize({ width: 900, height: 1000 });
  await expect(page.locator(".divider-left")).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".divider-right")).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.getByRole("button", { name: "注释", exact: true }).click();
  await expect(page.locator(".inspector")).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "恢复默认布局", exact: true }).click();
  await expect(left).toHaveAttribute("aria-valuenow", "224");
  await expect(
    page.getByRole("separator", { name: "调整注释设置宽度" }),
  ).toHaveAttribute("aria-valuenow", "296");
});

test("手形、空格和中键均可平移，拖动不误建注释或吞掉文本空格", async ({
  page,
}) => {
  await ready(page);
  for (let i = 0; i < 9; i++)
    await page.getByRole("button", { name: "放大", exact: true }).click();
  await expect(page.locator(".zoom-controls")).toContainText("180%");
  await expect
    .poll(async () => (await page.locator(".pdf-page").boundingBox())!.width)
    .toBeGreaterThan(1070);
  const canvas = page.locator(".document-canvas");
  await canvas.evaluate((e) => {
    e.scrollLeft = 70;
    e.scrollTop = 220;
  });
  const r = (await canvas.boundingBox())!;
  const point = { x: r.x + 250, y: r.y + 220 };
  await page.getByRole("button", { name: "拖动画布", exact: true }).click();
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x - 80, point.y - 50, { steps: 15 });
  await page.mouse.up();
  await expect
    .poll(() => canvas.evaluate((e) => Math.round(e.scrollLeft)))
    .toBe(150);
  await expect
    .poll(() => canvas.evaluate((e) => Math.round(e.scrollTop)))
    .toBe(270);
  await page.getByRole("button", { name: "选择文字", exact: true }).click();
  await page.mouse.move(point.x, point.y);
  await page.keyboard.down("Space");
  await expect(canvas).toHaveAttribute("data-hand-active", "true");
  await page.mouse.down();
  await page.mouse.move(point.x + 40, point.y + 30, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  await expect
    .poll(() => canvas.evaluate((e) => Math.round(e.scrollLeft)))
    .toBe(110);
  await expect
    .poll(() => canvas.evaluate((e) => Math.round(e.scrollTop)))
    .toBe(240);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(point.x + 30, point.y + 20, { steps: 10 });
  await page.mouse.up({ button: "middle" });
  await expect
    .poll(() => canvas.evaluate((e) => Math.round(e.scrollLeft)))
    .toBe(80);
  await expect(canvas).toHaveAttribute("data-panning", "false");
  await expect(page.locator(".annotation-item")).toHaveCount(3);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");
  await page.locator("#body").fill("正文空格");
  await page.locator("#body").press("Space");
  await expect(page.locator("#body")).toHaveValue("正文空格 ");
  await expect(canvas).toHaveAttribute("data-hand-active", "false");
});

test("Ctrl 滚轮保持鼠标指向，正常滚轮滚动，调整面板不移动注释坐标", async ({
  page,
}) => {
  await ready(page);
  for (let i = 0; i < 8; i++)
    await page.getByRole("button", { name: "放大", exact: true }).click();
  const canvas = page.locator(".document-canvas");
  await expect
    .poll(async () => (await page.locator(".pdf-page").boundingBox())!.width)
    .toBeGreaterThan(1000);
  await canvas.evaluate((e) => {
    e.scrollLeft = 80;
    e.scrollTop = 240;
  });
  const r = (await canvas.boundingBox())!;
  const point = { x: r.x + 300, y: r.y + 240 };
  const position = () =>
    page.locator(".pdf-page").evaluate((p, point) => {
      const r = p.getBoundingClientRect();
      return {
        x: (point.x - r.left) / r.width,
        y: (point.y - r.top) / r.height,
        width: r.width,
      };
    }, point);
  const before = await position();
  await page.mouse.move(point.x, point.y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -50);
  await page.keyboard.up("Control");
  await expect
    .poll(async () => (await position()).width)
    .toBeGreaterThan(before.width + 50);
  await expect
    .poll(async () => Math.abs((await position()).x - before.x))
    .toBeLessThan(0.005);
  await expect
    .poll(async () => Math.abs((await position()).y - before.y))
    .toBeLessThan(0.005);
  await expect(page.locator(".hotspot")).toHaveCount(3);
  const normalized = () =>
    page
      .locator(".hotspot")
      .first()
      .evaluate((a) => {
        const p = a.closest(".pdf-page")!.getBoundingClientRect(),
          r = a.getBoundingClientRect();
        return {
          x: (r.left - p.left) / p.width,
          y: (r.top - p.top) / p.height,
          w: r.width / p.width,
          h: r.height / p.height,
        };
      });
  const marker = await normalized();
  await dragDivider(page, "调整注释设置宽度", -60);
  const resized = await normalized();
  for (const key of ["x", "y", "w", "h"] as const)
    expect(resized[key]).toBeCloseTo(marker[key], 4);
  await expect(
    page.getByRole("button", { name: "撤销", exact: true }),
  ).toBeDisabled();
  const percent = await page
    .locator(".zoom-controls > span:not(.toolbar-divider)")
    .textContent();
  const top = await canvas.evaluate((e) => e.scrollTop);
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, 120);
  await expect
    .poll(() => canvas.evaluate((e) => e.scrollTop))
    .toBeGreaterThan(top + 50);
  await expect(
    page.locator(".zoom-controls > span:not(.toolbar-divider)"),
  ).toHaveText(percent!);
});
