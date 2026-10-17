import { test, expect } from "@playwright/test";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";

async function ready(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.locator(".save-status")).toContainText("已保存至本地");
}

test("误选可撤销重做，删除可恢复，文本框保留原生删除行为", async ({ page }) => {
  await ready(page);
  await page.getByRole("button", { name: "框选区域", exact: true }).click();
  const paper = (await page.locator(".pdf-page").boundingBox())!;
  await page.mouse.move(paper.x + 80, paper.y + 80);
  await page.mouse.down();
  await page.mouse.move(paper.x + 200, paper.y + 110, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator(".annotation-item")).toHaveCount(4);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.locator(".annotation-item")).toHaveCount(3);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(page.locator(".annotation-item")).toHaveCount(4);
  await page.locator("#body").fill("删除后应完整恢复的说明");
  await page.locator("#body").press("Backspace");
  await expect(page.locator(".annotation-item")).toHaveCount(4);
  const content = await page.locator("#body").inputValue();
  await page.getByRole("button", { name: "删除所选注释", exact: true }).click();
  await expect(page.locator(".annotation-item")).toHaveCount(3);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".annotation-item")).toHaveCount(4);
  await expect(page.locator("#body")).toHaveValue(content);
  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator(".annotation-item")).toHaveCount(3);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await page.locator(".annotation-delete").last().click();
  await expect(page.locator(".annotation-item")).toHaveCount(3);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.locator(".annotation-item")).toHaveCount(4);
  await expect(page.locator(".save-status")).toContainText("已保存至本地");
  await page.reload();
  await expect(page.locator(".annotation-item")).toHaveCount(4);
  await expect(
    page.getByRole("button", { name: "撤销", exact: true }),
  ).toBeDisabled();
});

test("文字只改字形颜色，浅色纸张不被染色，高清 PNG 导出保留原 PDF", async ({
  page,
}) => {
  await ready(page);
  const pdf = await PDFDocument.create();
  const sheet = pdf.addPage([400, 500]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  sheet.drawRectangle({
    x: 0,
    y: 0,
    width: 400,
    height: 500,
    color: rgb(0.95, 0.93, 0.9),
  });
  sheet.drawText("BLUE THEME", {
    x: 40,
    y: 450,
    size: 22,
    font,
    color: rgb(0.1, 0.3, 0.7),
  });
  sheet.drawText("COLOR TARGET", {
    x: 40,
    y: 370,
    size: 20,
    font,
    color: rgb(0, 0, 0),
  });
  const original = Buffer.from(await pdf.save());
  page.on("dialog", (d) => d.accept());
  // The new, prominent header button opens the real file chooser.
  const chooserEvent = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "上传 PDF", exact: true }).click();
  await (
    await chooserEvent
  ).setFiles({
    name: "quality-fixture.pdf",
    mimeType: "application/pdf",
    buffer: original,
  });
  await expect(page.locator(".annotation-item")).toHaveCount(0);
  await expect(
    page.locator(".textLayer span").filter({ hasText: "COLOR TARGET" }),
  ).toBeVisible();
  await expect(page.locator(".save-status")).toContainText("已保存至本地");
  const before = await page
    .locator(".pdf-page>canvas")
    .evaluate((c: HTMLCanvasElement) => ({
      width: c.width,
      height: c.height,
      cssWidth: c.getBoundingClientRect().width,
      pixels: Array.from(
        c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data,
      ),
    }));
  expect(before.width / before.cssWidth).toBeGreaterThanOrEqual(2);
  const span = (await page
    .locator(".textLayer span")
    .filter({ hasText: "COLOR TARGET" })
    .boundingBox())!;
  await page.mouse.move(span.x + 1, span.y + span.height / 2);
  await page.mouse.down();
  await page.mouse.move(span.x + span.width - 1, span.y + span.height / 2, {
    steps: 25,
  });
  await page.mouse.up();
  await expect(page.locator(".annotation-item")).toHaveCount(1);
  await page.getByRole("button", { name: "卡片样式", exact: true }).click();
  await expect(page.locator(".color-options>button")).toHaveCount(12);
  await expect(page.locator(".recommended-color")).toContainText(
    "根据 PDF 主色调配",
  );
  await page.getByRole("button", { name: "颜色 #b17d8d", exact: true }).click();
  await expect(page.locator(".save-status")).toContainText("已保存至本地");
  await expect
    .poll(async () =>
      page.locator(".pdf-page>canvas").evaluate((c: HTMLCanvasElement) => {
        const d = c
          .getContext("2d")!
          .getImageData(0, 0, c.width, c.height).data;
        let colored = 0;
        for (let i = 0; i < d.length; i += 4)
          if (
            Math.abs(d[i] - 177) < 4 &&
            Math.abs(d[i + 1] - 125) < 4 &&
            Math.abs(d[i + 2] - 141) < 4
          )
            colored++;
        return colored;
      }),
    )
    .toBeGreaterThan(100);
  const after = await page
    .locator(".pdf-page>canvas")
    .evaluate((c: HTMLCanvasElement) =>
      Array.from(
        c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data,
      ),
    );
  const paperColor = before.pixels.slice(0, 3);
  let paperPixels = 0,
    changedPaper = 0,
    changedInk = 0;
  for (let i = 0; i < after.length; i += 4) {
    if (
      before.pixels[i] === paperColor[0] &&
      before.pixels[i + 1] === paperColor[1] &&
      before.pixels[i + 2] === paperColor[2]
    ) {
      paperPixels++;
      if (
        after[i] !== paperColor[0] ||
        after[i + 1] !== paperColor[1] ||
        after[i + 2] !== paperColor[2]
      )
        changedPaper++;
    }
    if (before.pixels[i] < 30 && after[i] > 120) changedInk++;
  }
  expect(paperPixels).toBeGreaterThan(10000);
  expect(changedPaper).toBe(0);
  expect(changedInk).toBeGreaterThan(100);
  const appearance = await page.locator(".hotspot.text").evaluate((e) => {
    const s = getComputedStyle(e);
    return {
      background: s.backgroundColor,
      border: s.borderBottomWidth,
      shadow: s.boxShadow,
    };
  });
  expect(appearance).toEqual({
    background: "rgba(0, 0, 0, 0)",
    border: "0px",
    shadow: "none",
  });
  await page.getByRole("button", { name: "阅读预览", exact: true }).click();
  const frame = page.frameLocator('iframe[title="独立阅读器预览"]');
  await expect(frame.locator(".page>img")).toHaveAttribute(
    "src",
    /^data:image\/png/,
  );
  expect(
    await frame
      .locator(".page>img")
      .evaluate((e: HTMLImageElement) => e.naturalWidth),
  ).toBe(1200);
  await expect(frame.locator(".hotspot")).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
  await page.getByRole("button", { name: "导出", exact: true }).click();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: /可编辑项目 ZIP/ }).click();
  const download = await downloadEvent;
  const zip = await JSZip.loadAsync(await readFile((await download.path())!));
  expect(await zip.file("resume.pdf")!.async("nodebuffer")).toEqual(original);
});

test("高分屏按设备像素渲染，200% 缩放重新绘制而非拉伸旧图", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1100 },
    deviceScaleFactor: 3,
  });
  const page = await context.newPage();
  await ready(page);
  await expect
    .poll(async () =>
      page
        .locator(".pdf-page>canvas")
        .evaluate(
          (c: HTMLCanvasElement) => c.width / c.getBoundingClientRect().width,
        ),
    )
    .toBeGreaterThanOrEqual(3);
  for (let i = 0; i < 11; i++)
    await page.getByRole("button", { name: "放大", exact: true }).click();
  await expect(page.locator(".zoom-controls")).toContainText("200%");
  await expect
    .poll(async () =>
      page
        .locator(".pdf-page>canvas")
        .evaluate((c: HTMLCanvasElement) => c.width),
    )
    .toBeGreaterThan(3200);
  const pixels = await page
    .locator(".pdf-page>canvas")
    .evaluate((c: HTMLCanvasElement) => c.width * c.height);
  expect(pixels).toBeLessThan(16_010_000);
  await context.close();
});
