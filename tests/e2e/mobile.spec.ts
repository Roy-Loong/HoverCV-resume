import { test, expect, devices } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { encryptReader, readerLink } from "../../lib/read-link";

for (const device of ["iPhone 13", "Pixel 7"] as const) {
  test(`${device}：手机网页点击看图文、翻图、关闭与导出入口`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ ...devices[device], baseURL });
    const page = await context.newPage(),
      errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await expect(page.locator(".hotspot").first()).toBeVisible();
    await page.getByRole("button", { name: "阅读", exact: true }).click();
    await page.locator(".hotspot").first().tap();
    const card = page.locator(".hover-card");
    await expect(card).toBeVisible();
    await page.waitForTimeout(400); // Touch release must not schedule a 150 ms close.
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "下一张", exact: true }).tap();
    await expect(card.locator(".media-controls span")).toContainText("02");
    await card.getByRole("button", { name: "关闭注释", exact: true }).tap();
    await expect(card).toHaveCount(0);
    await page.locator(".hotspot").first().tap();
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "关闭注释", exact: true }).tap();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "导出", exact: true }).tap();
    await expect(
      page.getByRole("button", { name: /^悬浮交互 PDF/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: /^手机阅读链接/ }).tap();
    await expect(
      page.getByRole("region", { name: "手机阅读链接设置" }),
    ).toContainText("服务尚未开通");
    await expect(
      page.getByRole("button", { name: "复制体验网址", exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
    await context.close();
  });

  test(`${device}：加密阅读链接直接打开，在独立只读页面点击、翻图和关闭`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ ...devices[device], baseURL }),
      page = await context.newPage();
    await page.goto("/");
    await expect(page.locator(".hotspot").first()).toBeVisible();
    await page.getByRole("button", { name: "导出", exact: true }).tap();
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: /独立 HTML/ }).tap();
    const download = await downloadEvent,
      path = await download.path();
    if (!path) throw Error("Missing reader export");
    const html = await readFile(path, "utf8"),
      packed = await encryptReader(html);
    const blobUrl =
      "https://test.public.blob.vercel-storage.com/readers/12345678-1234-1234-1234-123456789abc.hcv";
    const bytes = Buffer.from(await packed.blob.arrayBuffer());
    const receivedRequests: string[] = [];
    await page.route(blobUrl, (r) => {
      receivedRequests.push(r.request().url());
      return r.fulfill({
        body: bytes,
        contentType: "application/octet-stream",
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    });
    const link = readerLink(baseURL!, blobUrl, packed.key);
    await page.goto(link);
    const reader = page.frameLocator('iframe[title="手机交互简历"]');
    await expect(reader.locator(".page>img").first()).toBeVisible();
    await reader.locator(".hotspot").first().tap();
    const card = reader.locator("#card");
    await expect(card).toBeVisible();
    await page.waitForTimeout(400);
    await expect(card).toBeVisible();
    await expect(card.locator("nav span")).toHaveText("1 / 3");
    await card.getByRole("button", { name: "下一张", exact: true }).tap();
    await expect(card.locator("nav span")).toHaveText("2 / 3");
    await card.getByRole("button", { name: "关闭", exact: true }).tap();
    await expect(card).toBeHidden();
    await reader.locator(".hotspot").first().tap();
    await expect(card).toBeVisible();
    const rect = await card.boundingBox();
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.width).toBeLessThanOrEqual(devices[device].viewport.width);
    expect(receivedRequests).toEqual([blobUrl]);
    expect(receivedRequests.join("")).not.toContain(packed.key);
    await context.close();
  });
}
