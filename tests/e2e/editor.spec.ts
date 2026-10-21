import { test, expect } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";
async function ready(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.locator(".hotspot")).toHaveCount(3);
  await expect(page.locator(".save-status")).toContainText("已保存至本地");
}
test("真实鼠标跨过间隙进入卡片、翻图、滚动、链接、离开关闭、单卡切换", async ({
  page,
}) => {
  await ready(page);
  const spot = page.locator(".hotspot").first();
  await spot.hover();
  const card = page.locator(".hover-card");
  await expect(card).toBeVisible();
  expect((await card.boundingBox())!.width).toBe(360);
  expect((await card.boundingBox())!.height).toBe(420);
  const b = (await card.boundingBox())!;
  await page.mouse.move(b.x + 110, b.y + 100, { steps: 35 });
  await page.waitForTimeout(400);
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "下一张" }).click();
  await expect(card.locator(".media-controls")).toContainText("02");
  await card.hover();
  await page.mouse.wheel(0, 450);
  await expect(card.locator(".card-link")).toHaveAttribute("target", "_blank");
  const popupEvent = page.waitForEvent("popup");
  await card.locator(".card-link").click();
  const popup = await popupEvent;
  await popup.close();
  await page.mouse.move(300, 110, { steps: 12 });
  await expect(card).toHaveCount(0);
  await spot.hover();
  await page.locator(".hotspot").nth(1).hover();
  await expect(page.locator(".hover-card")).toHaveCount(1);
  await expect(page.locator(".hover-card h2")).toContainText("Bloom");
  await page.keyboard.press("Escape");
  await expect(page.locator(".hover-card")).toHaveCount(0);
});
test("文字多行创建、编辑保存恢复、缩放、区域重新定位", async ({ page }) => {
  await ready(page);
  const spans = page.locator(".textLayer span");
  const first = spans.filter({ hasText: "Led the design" }).first();
  const last = spans.filter({ hasText: "Partnered with engineering" }).first();
  const a = (await first.boundingBox())!,
    b = (await last.boundingBox())!;
  await page.mouse.move(a.x + 10, a.y + 3);
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.move(b.x + b.width - 2, b.y + b.height / 2, { steps: 30 });
  await page.waitForTimeout(100);
  await page.mouse.up();
  await expect(page.locator(".annotation-item")).toHaveCount(4);
  await expect(page.locator(".hotspot")).toHaveCount(6);
  await page.locator("#title").fill("真实选择测试");
  await page.locator("#body").fill("这段说明来自真实文字选择");
  await expect(page.locator(".save-status")).toContainText("已保存至本地");
  await page.reload();
  await expect(page.locator(".annotation-item")).toHaveCount(4);
  await page
    .locator(".annotation-item")
    .filter({ hasText: "真实选择测试" })
    .click();
  await expect(page.locator("#body")).toHaveValue("这段说明来自真实文字选择");
  await page.getByRole("button", { name: "放大", exact: true }).click();
  await expect(page.locator(".zoom-controls")).toContainText("100%");
  await page.getByRole("button", { name: "框选区域" }).click();
  const paper = (await page.locator(".pdf-page").boundingBox())!;
  await page.mouse.move(paper.x + 100, paper.y + 120);
  await page.mouse.down();
  await page.mouse.move(paper.x + 220, paper.y + 160, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator(".annotation-item")).toHaveCount(5);
  await page.locator("#title").fill("手动扫描区域");
  await page.getByRole("button", { name: "卡片样式" }).click();
  await page.getByRole("button", { name: "重新定位此注释" }).click();
  await page.mouse.move(paper.x + 150, paper.y + 200);
  await page.mouse.down();
  await page.mouse.move(paper.x + 250, paper.y + 230, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator(".annotation-item")).toHaveCount(5);
  await expect(page.locator("#title")).toHaveValue("手动扫描区域");
});
test("独立 HTML 在离线文档中读取，项目 ZIP 可恢复", async ({
  page,
  browser,
}) => {
  await ready(page);
  await page.getByRole("button", { name: "导出", exact: true }).click();
  const htmlEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: /独立 HTML/ }).click();
  const html = await htmlEvent;
  await mkdir("/tmp/hovercv-export-test", { recursive: true });
  const file = "/tmp/hovercv-export-test/resume.html";
  await html.saveAs(file);
  const content = await readFile(file, "utf8");
  expect(content).not.toMatch(/(?:blob:|localhost|pdf\.worker)/);
  const context = await browser.newContext();
  await context.setOffline(true);
  const standalone = await context.newPage();
  const errors: string[] = [];
  standalone.on("pageerror", (e) => errors.push(e.message));
  await standalone.setContent(content);
  await expect(standalone.locator(".page>img")).toHaveJSProperty(
    "complete",
    true,
  );
  await standalone.locator(".hotspot").first().hover();
  await expect(standalone.locator("#card")).toBeVisible();
  await standalone
    .locator("#card")
    .getByRole("button", { name: "下一张" })
    .click();
  await expect(standalone.locator("#card nav")).toContainText("2 / 3");
  expect(errors).toEqual([]);
  await context.close();
  const zipEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: /可编辑项目 ZIP/ }).click();
  const zipDownload = await zipEvent;
  const zipPath = "/tmp/hovercv-export-test/project.zip";
  await zipDownload.saveAs(zipPath);
  const zip = await JSZip.loadAsync(await readFile(zipPath));
  expect(zip.file("resume.pdf")).not.toBeNull();
  const manifest = JSON.parse(await zip.file("project.json")!.async("string"));
  expect(manifest.schemaVersion).toBe(1);
  await page.getByRole("button", { name: "关闭窗口" }).click();
  await page.locator("input[type=file]").nth(1).setInputFiles(zipPath);
  await expect(
    page.getByRole("status").filter({ hasText: "可编辑项目已恢复" }),
  ).toBeVisible();
});
test("缺密钥显示未配置、不覆盖现有说明，手机显示底部卡片", async ({
  page,
  browser,
}) => {
  await ready(page);
  const original = await page.locator("#body").inputValue();
  await page.getByRole("button", { name: "AI 帮我补充" }).click();
  await expect(page.getByText("AI 服务未配置")).toBeVisible();
  await page.getByRole("button", { name: "关闭窗口" }).click();
  await expect(page.locator("#body")).toHaveValue(original);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const mobile = await context.newPage();
  await ready(mobile);
  await mobile.locator(".hotspot").first().tap();
  const card = mobile.locator(".hover-card");
  await expect(card).toBeVisible();
  const b = (await card.boundingBox())!;
  expect(b.width).toBeLessThanOrEqual(390 * 0.9 + 1);
  expect(b.y + b.height).toBeLessThanOrEqual(844);
  await mobile.screenshot({ path: "/tmp/hovercv-mobile.png" });
  await context.close();
});
test("上传真实 PDF，三模板、四色、视频播放关闭暂停与轮播清理", async ({
  page,
}) => {
  await ready(page);
  page.on("dialog", (d) => d.accept());
  await page
    .locator("input[type=file]")
    .nth(0)
    .setInputFiles("public/demo.pdf");
  await expect(page.locator(".annotation-item")).toHaveCount(0);
  await page.getByRole("button", { name: "框选区域" }).click();
  await expect(page.locator(".textLayer span").first()).toBeVisible();
  const p = (await page.locator(".pdf-page").boundingBox())!;
  await page.mouse.move(p.x + 90, p.y + 100);
  await page.mouse.down();
  await page.mouse.move(p.x + 220, p.y + 150, { steps: 15 });
  await page.mouse.up();
  await expect(page.locator(".annotation-item")).toHaveCount(1);
  await page.locator("#title").fill("视频注释验证");
  await page
    .locator("input[type=file]")
    .nth(2)
    .setInputFiles("tests/fixtures/original-demo.webm");
  await expect(page.locator(".media-item")).toHaveCount(1);
  await page.getByRole("button", { name: "卡片样式" }).click();
  for (const name of ["简介", "图文", "封面"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.getByRole("button", { name, exact: true })).toHaveClass(
      "selected",
    );
  }
  await page.getByRole("button", { name: "颜色 #52978c" }).click();
  await page.getByRole("button", { name: "阅读", exact: true }).click();
  await page.locator(".hotspot").hover();
  const card = page.locator(".hover-card");
  await expect(card).toBeVisible();
  const video = card.locator("video");
  await video.evaluate((v: HTMLVideoElement) => v.play());
  await expect(video).toHaveJSProperty("paused", false);
  const handle = await video.elementHandle();
  await page.mouse.move(280, 100, { steps: 15 });
  await expect(card).toHaveCount(0);
  expect(await handle!.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
});

test("180/250ms 悬浮延迟、3.5 秒轮播与控件暂停", async ({ page }) => {
  await ready(page);
  await page.getByRole("button", { name: "卡片样式" }).click();
  await page.locator(".toggle-row input").check();
  await page.getByRole("button", { name: "阅读", exact: true }).click();
  await page.clock.install({ time: new Date("2026-10-17T15:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-17T15:00:01Z"));
  await page.locator(".hotspot").first().hover();
  await page.clock.runFor(179);
  await expect(page.locator(".hover-card")).toHaveCount(0);
  await page.clock.runFor(2);
  const card = page.locator(".hover-card");
  await expect(card).toBeVisible();
  await page.clock.runFor(3500);
  await expect(card.locator(".media-controls")).toContainText("02");
  const word = (await page.locator(".hotspot").first().boundingBox())!,
    popup = (await card.boundingBox())!;
  const gapX =
    popup.x > word.x
      ? (word.x + word.width + popup.x) / 2
      : (popup.x + popup.width + word.x) / 2;
  await page.mouse.move(gapX, word.y + word.height / 2);
  await page.clock.runFor(220);
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "下一张" }).hover();
  await page.clock.runFor(7000);
  await expect(card.locator(".media-controls")).toContainText("02");
  await page.mouse.move(280, 110, { steps: 5 });
  await page.clock.runFor(249);
  await expect(card).toBeVisible();
  await page.clock.runFor(2);
  await expect(card).toHaveCount(0);
  await page.clock.runFor(10000);
  await page.locator(".hotspot").first().hover();
  await page.clock.runFor(181);
  await expect(page.locator(".hover-card .media-controls")).toContainText("01");
});

test("真实图片导入、排序、替换与说明编辑", async ({ page }) => {
  await ready(page);
  const bytes = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 400;
    c.height = 240;
    const x = c.getContext("2d")!;
    x.fillStyle = "#e5dfef";
    x.fillRect(0, 0, 400, 240);
    x.fillStyle = "#6958d5";
    x.fillRect(80, 60, 240, 120);
    return Array.from(
      Uint8Array.from(atob(c.toDataURL("image/png").split(",")[1]), (c) =>
        c.charCodeAt(0),
      ),
    );
  });
  await page
    .locator("input[type=file]")
    .nth(2)
    .setInputFiles(
      [1, 2, 3].map((n) => ({
        name: `original-${n}.png`,
        mimeType: "image/png",
        buffer: Buffer.from(bytes),
      })),
    );
  await expect(page.locator(".media-item")).toHaveCount(6);
  const last = page.locator(".media-item").last();
  await last.locator("input").fill("手动上传的原创图片");
  await last.getByRole("button", { name: "素材上移" }).click();
  await expect(page.locator(".media-item").nth(4).locator("input")).toHaveValue(
    "手动上传的原创图片",
  );
  const chooser = page.waitForEvent("filechooser");
  await page
    .locator(".media-item")
    .nth(4)
    .getByRole("button", { name: "替换", exact: true })
    .click();
  await (
    await chooser
  ).setFiles({
    name: "replacement.png",
    mimeType: "image/png",
    buffer: Buffer.from(bytes),
  });
  await expect(page.locator(".media-item")).toHaveCount(6);
  await expect(page.locator(".media-item").nth(4).locator("input")).toHaveValue(
    "replacement.png",
  );
  await page
    .locator(".media-item")
    .nth(4)
    .getByRole("button", { name: "删除素材 5" })
    .click();
  await expect(page.locator(".media-item")).toHaveCount(5);
});

test("重新上传相同 PDF 后，新项目能保存并在刷新后恢复", async ({ page }) => {
  await ready(page);
  const oldId = await page.evaluate(() => localStorage.getItem("hovercv:last"));
  page.on("dialog", (d) => d.accept());
  await page
    .locator("input[type=file]")
    .nth(0)
    .setInputFiles("public/demo.pdf");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("hovercv:last")))
    .not.toBe(oldId);
  await expect(page.locator(".annotation-item")).toHaveCount(0);
  await page.getByRole("button", { name: "框选区域" }).click();
  await expect(page.locator(".textLayer span").first()).toBeVisible();
  const r = (await page.locator(".pdf-page").boundingBox())!;
  await page.mouse.move(r.x + 100, r.y + 110);
  await page.mouse.down();
  await page.mouse.move(r.x + 240, r.y + 160, { steps: 15 });
  await page.mouse.up();
  await page.locator("#title").fill("重复 PDF 项目恢复验证");
  await page.locator("#body").fill("这次上传的新项目也必须被保存");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const id = localStorage.getItem("hovercv:last")!;
        return new Promise<string>((resolve, reject) => {
          const request = indexedDB.open("hovercv");
          request.onsuccess = () => {
            const db = request.result;
            const get = db
              .transaction("projects")
              .objectStore("projects")
              .get(id);
            get.onsuccess = () => {
              resolve(get.result?.annotations?.[0]?.body || "");
              db.close();
            };
            get.onerror = () => reject(get.error);
          };
        });
      }),
    )
    .toBe("这次上传的新项目也必须被保存");
  await page.reload();
  await page
    .locator(".annotation-item")
    .filter({ hasText: "重复 PDF 项目恢复验证" })
    .click();
  await expect(page.locator("#body")).toHaveValue(
    "这次上传的新项目也必须被保存",
  );
});
