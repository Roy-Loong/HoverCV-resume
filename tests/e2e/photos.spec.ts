import { test, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import JSZip from "jszip";

test("照片原图比例、缩放拖动、保存恢复、撤销与离线导出保持一致", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  await page.goto("/");
  await expect(page.locator(".save-status")).toContainText("已保存至本地");
  for (let i = 0; i < 3; i++)
    await page
      .locator(".media-item")
      .first()
      .getByRole("button", { name: /删除素材/ })
      .click();
  const bytes = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 100;
    canvas.height = 300;
    const ctx = canvas.getContext("2d")!;
    for (const [i, color] of ["#ee4444", "#44bb66", "#3366dd"].entries()) {
      ctx.fillStyle = color;
      ctx.fillRect(0, i * 100, 100, 100);
    }
    return Array.from(
      Uint8Array.from(atob(canvas.toDataURL().split(",")[1]), (c) =>
        c.charCodeAt(0),
      ),
    );
  });
  await page
    .locator("input[type=file]")
    .nth(2)
    .setInputFiles({
      name: "portrait-stripes.png",
      mimeType: "image/png",
      buffer: Buffer.from(bytes),
    });
  await page.getByRole("button", { name: "调整图片 1", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "调整图片", exact: true });
  const frame = dialog.locator(".image-frame");
  await expect(
    dialog.getByRole("button", { name: "原图比例", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(async () =>
      frame.evaluate(
        (e) =>
          e.getBoundingClientRect().height / e.getBoundingClientRect().width,
      ),
    )
    .toBeCloseTo(3, 2);
  await expect(frame.locator("img")).toHaveCSS("object-fit", "contain");
  await dialog.getByRole("button", { name: "完整显示", exact: true }).click();
  await expect(frame).toHaveCSS("height", "200px");
  await dialog.getByRole("button", { name: "铺满裁切", exact: true }).click();
  await dialog
    .getByRole("slider", { name: "图片显示高度", exact: true })
    .press("End");
  await expect(frame).toHaveCSS("height", "480px");
  await dialog
    .getByRole("slider", { name: "图片显示高度", exact: true })
    .press("Home");
  await dialog
    .getByRole("slider", { name: "图片显示高度", exact: true })
    .press("ArrowRight");
  await expect(frame).toHaveCSS("height", "110px");
  const zoom = dialog.getByRole("slider", { name: "图片缩放", exact: true });
  await zoom.press("End");
  await expect(zoom).toHaveValue("300");
  const bounds = (await frame.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 55);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 20, bounds.y + 80, {
    steps: 12,
  });
  await page.mouse.up();
  expect(
    Number(
      await dialog
        .getByRole("slider", { name: "图片上下位置", exact: true })
        .inputValue(),
    ),
  ).toBeLessThan(50);
  expect(
    Number(
      await dialog
        .getByRole("slider", { name: "图片左右位置", exact: true })
        .inputValue(),
    ),
  ).toBeLessThan(50);
  await dialog
    .getByRole("slider", { name: "图片上下位置", exact: true })
    .press("End");
  await dialog
    .getByRole("slider", { name: "图片左右位置", exact: true })
    .press("Home");
  const style = await frame.locator("img").evaluate((img) => ({
    fit: getComputedStyle(img).objectFit,
    position: getComputedStyle(img).objectPosition,
    transform: getComputedStyle(img).transform,
    origin: img.style.transformOrigin,
  }));
  expect(style).toMatchObject({
    fit: "cover",
    position: "0% 100%",
    transform: "matrix(3, 0, 0, 3, 0, 0)",
  });
  await page.screenshot({ path: "/tmp/hovercv-photo-adjustment.png" });
  await dialog.getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.locator(".save-status")).toContainText("已保存至本地");
  await page.reload();
  await page.getByRole("button", { name: "调整图片 1", exact: true }).click();
  await expect(zoom).toHaveValue("300");
  await expect(
    dialog.getByRole("slider", { name: "图片上下位置", exact: true }),
  ).toHaveValue("100");
  await dialog.getByRole("button", { name: "恢复原图", exact: true }).click();
  await expect(zoom).toHaveValue("100");
  await expect(
    dialog.getByRole("button", { name: "原图比例", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "完成", exact: true }).click();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.locator(".save-status")).toContainText("已保存至本地");

  // Render the same crop in all three card templates.
  await page.getByRole("button", { name: "卡片样式", exact: true }).click();
  for (const template of ["简介", "图文", "封面"]) {
    await page.getByRole("button", { name: template, exact: true }).click();
    await page.locator(".hotspot").first().hover();
    const img = page.locator(".hover-card .image-frame img");
    await expect(img).toHaveCSS("object-position", style.position);
    await expect(img).toHaveCSS("transform", style.transform);
    await page.keyboard.press("Escape");
  }
  await expect(page.locator(".save-status")).toContainText("已保存至本地");
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await mkdir("/tmp/hovercv-photo-test", { recursive: true });
  const download = async (label: RegExp, name: string) => {
    const event = page.waitForEvent("download");
    await page.getByRole("button", { name: label }).click();
    const path = `/tmp/hovercv-photo-test/${name}`;
    await (await event).saveAs(path);
    return readFile(path);
  };
  const html = (await download(/独立 HTML/, "resume.html")).toString();
  const zip = await JSZip.loadAsync(
    await download(/可编辑项目 ZIP/, "project.zip"),
  );
  const project = JSON.parse(await zip.file("project.json")!.async("string"));
  const photo = project.annotations[0].media[0];
  expect(photo.imageLayout).toMatchObject({
    fit: "cover",
    zoom: 3,
    x: 0,
    y: 100,
    height: 110,
  });
  expect(Buffer.from(photo.src.split(",")[1], "base64")).toEqual(
    Buffer.from(bytes),
  );

  const context = await browser.newContext({ offline: true });
  const reader = await context.newPage();
  await reader.setContent(html);
  await reader.locator(".hotspot").first().hover();
  const exportedImage = reader.locator("#card .image-frame img");
  await expect(exportedImage).toHaveCSS("object-fit", style.fit);
  await expect(exportedImage).toHaveCSS("object-position", style.position);
  await expect(exportedImage).toHaveCSS("transform", style.transform);
  await expect(reader.locator("#card .image-frame")).toHaveCSS(
    "height",
    "110px",
  );
  await context.close();
  await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
  await page
    .locator("input[type=file]")
    .nth(1)
    .setInputFiles("/tmp/hovercv-photo-test/project.zip");
  await expect(
    page.getByRole("status").filter({ hasText: "可编辑项目已恢复" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "内容编辑", exact: true }).click();
  await page.getByRole("button", { name: "调整图片 1", exact: true }).click();
  await expect(zoom).toHaveValue("300");
});

test("离线阅读关闭等待为250ms，持续移动不延长，重入卡片取消关闭", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await expect(page.locator(".save-status")).toContainText("已保存至本地");
  await page.getByRole("button", { name: "导出", exact: true }).click();
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: /独立 HTML/ }).click();
  const file = await (await event).path();
  const context = await browser.newContext({ offline: true });
  const reader = await context.newPage();
  await reader.setContent(await readFile(file!, "utf8"));
  await reader.clock.install({ time: new Date("2026-10-18T01:00:00Z") });
  await reader.clock.pauseAt(new Date("2026-10-18T01:00:01Z"));
  await reader.locator(".hotspot").first().hover();
  await reader.clock.runFor(181);
  const card = reader.locator("#card");
  await expect(card).toBeVisible();
  const box = (await card.boundingBox())!,
    word = (await reader.locator(".hotspot").first().boundingBox())!;
  const gapX =
    box.x > word.x
      ? (word.x + word.width + box.x) / 2
      : (box.x + box.width + word.x) / 2;
  await reader.mouse.move(gapX, word.y + word.height / 2);
  await reader.clock.runFor(220);
  await expect(card).toBeVisible();
  await reader.mouse.move(box.x + 60, box.y + 20);
  await reader.clock.runFor(1000);
  await expect(card).toBeVisible();
  await reader.mouse.move(20, 20);
  await reader.clock.runFor(100);
  await reader.mouse.move(box.x + 60, box.y + 20);
  await reader.clock.runFor(200);
  await expect(card).toBeVisible();
  await reader.mouse.move(20, 20);
  await reader.clock.runFor(100);
  await reader.mouse.move(30, 25);
  await reader.clock.runFor(149);
  await expect(card).toBeVisible();
  await reader.clock.runFor(2);
  await expect(card).toBeHidden();
  await context.close();
});
