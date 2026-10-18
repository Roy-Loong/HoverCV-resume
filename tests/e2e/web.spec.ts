import { test, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import JSZip from "jszip";

test.skip(
  process.env.HOVERCV_TEST_BROWSER_ONLY !== "1",
  "Run against npm run build:web with HOVERCV_TEST_BROWSER_ONLY=1",
);

test("朋友无需账户完成上传、文字标注、三种导出和恢复，PDF 不发往服务器", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const requests: { url: string; method: string }[] = [];
  const errors: string[] = [];
  page.on("request", (r) =>
    requests.push({ url: r.url(), method: r.method() }),
  );
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator(".save-status")).toContainText("已保存至本地");
  await expect(page.getByRole("button", { name: "发布简历" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "登录账户" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "AI 帮我补充" })).toHaveCount(
    0,
  );

  // Exercise the visible upload button and browser file chooser.
  page.on("dialog", (dialog) => dialog.accept());
  const choose = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "上传 PDF", exact: true }).click();
  await (await choose).setFiles("public/demo.pdf");
  await expect(page.locator(".annotation-item")).toHaveCount(0);
  const company = page
    .locator(".textLayer span")
    .filter({ hasText: /^Lumen Studio$/ });
  await expect(company).toBeVisible();
  const rect = (await company.boundingBox())!;
  await page.mouse.move(rect.x + 1, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width - 1, rect.y + rect.height / 2, {
    steps: 20,
  });
  await page.mouse.up();
  await expect(page.locator(".annotation-item")).toHaveCount(1);
  await page.locator("#title").fill("朋友的体验标注");
  await page
    .locator("#body")
    .fill("上传自己的 PDF 后就可以添加说明，并导出交互简历。");
  await expect(page.locator(".save-status")).toContainText("已保存至本地");
  await page.reload();
  await expect(page.locator("#title")).toHaveValue("朋友的体验标注");
  await expect(page.locator(".save-status")).toContainText("已保存至本地");
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await mkdir("/tmp/hovercv-web-test", { recursive: true });
  const files: Record<string, Buffer> = {};
  for (const [name, label] of [
    ["html", /独立 HTML/],
    ["offline", /离线阅读 ZIP/],
    ["project", /可编辑项目 ZIP/],
  ] as const) {
    const event = page.waitForEvent("download");
    await page.getByRole("button", { name: label }).click();
    const download = await event;
    const path = `/tmp/hovercv-web-test/${name}`;
    await download.saveAs(path);
    files[name] = await readFile(path);
  }
  const project = await JSZip.loadAsync(files.project);
  expect(await project.file("resume.pdf")!.async("nodebuffer")).toEqual(
    await readFile("public/demo.pdf"),
  );
  const manifest = JSON.parse(
    await project.file("project.json")!.async("string"),
  );
  expect(manifest.annotations).toHaveLength(1);
  expect(manifest.annotations[0].title).toBe("朋友的体验标注");
  const offline = await JSZip.loadAsync(files.offline);
  expect(await offline.file("index.html")!.async("string")).toBe(
    files.html.toString(),
  );

  const readerContext = await browser.newContext({ offline: true });
  const reader = await readerContext.newPage();
  await reader.setContent(files.html.toString());
  await expect(reader.locator(".page>img")).toHaveJSProperty("complete", true);
  await reader.locator(".hotspot").hover();
  await expect(reader.locator("#card")).toContainText("朋友的体验标注");
  await readerContext.close();

  await page.getByRole("button", { name: "关闭窗口" }).click();
  await page
    .locator("input[type=file]")
    .nth(1)
    .setInputFiles("/tmp/hovercv-web-test/project");
  await expect(
    page.getByRole("status").filter({ hasText: "可编辑项目已恢复" }),
  ).toBeVisible();
  expect(
    requests.filter((r) => new URL(r.url).pathname.startsWith("/api/")),
  ).toEqual([]);
  expect(requests.filter((r) => r.method !== "GET")).toEqual([]);
  expect(errors).toEqual([]);
});
