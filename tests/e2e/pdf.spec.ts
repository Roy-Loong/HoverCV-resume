import { test, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { PDFDocument, PDFDict, PDFName, PDFRawStream } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { checkNativePdfTransfer } from "./pdf-native-helper";

test("PDF 生成失败可重试，明确点击即可保存原页数的悬浮 PDF", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(90000);
  const requests: { method: string; url: string }[] = [];
  const errors: string[] = [];
  page.on("request", (r) =>
    requests.push({ method: r.method(), url: r.url() }),
  );
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator(".save-status")).toContainText("已保存至本地");
  await page.locator(".hotspot").first().hover();
  await expect(page.locator(".hover-card")).toBeVisible();
  const webCard = (await page.locator(".hover-card").boundingBox())!;
  expect(webCard.width).toBe(360);
  expect(webCard.height).toBe(420);
  await page.keyboard.press("Escape");
  await page.locator("#title").fill("中文图文下载测试");
  await page.locator("#body").fill("图片位置和缩放保留，悬停查看图文。♥囍");
  await expect(page.locator(".save-status")).toContainText("已保存至本地");
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await page.route("**/fonts/DroidSansFallback.ttf", (r) =>
    r.fulfill({ status: 503, body: "unavailable" }),
  );
  const generate = page.getByRole("button", { name: /^悬浮交互 PDF/ });
  await generate.click();
  await expect(page.locator(".pdf-export-error")).toContainText(
    "PDF 字体下载失败",
  );
  await expect(generate).toBeEnabled();
  await page.unroute("**/fonts/DroidSansFallback.ttf");
  await generate.click();
  const link = page.getByRole("link", { name: /下载悬浮交互 PDF/ });
  await expect(link).toBeVisible({ timeout: 45000 });
  await expect(link).toHaveAttribute("href", /^blob:/);
  await expect(link).toHaveAttribute("download", /_悬浮交互\.pdf$/);
  const event = page.waitForEvent("download");
  await link.click();
  const download = await event;
  expect(await download.failure()).toBeNull();
  await mkdir("/tmp/hovercv-pdf-test", { recursive: true });
  const path = "/tmp/hovercv-pdf-test/download.pdf";
  await download.saveAs(path);
  const bytes = await readFile(path);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  const saved = await PDFDocument.load(bytes);
  expect(saved.getPageCount()).toBe(1);
  const fields = saved.getForm().getFields();
  expect(fields.filter((f) => f.getName().includes("_hover_"))).toHaveLength(3);
  expect(fields.filter((f) => f.getName().includes("_panel_"))).toHaveLength(
    10,
  );
  const task = getDocument({ data: new Uint8Array(bytes) }),
    pdf = await task.promise;
  try {
    expect(pdf.numPages).toBe(1);
    const original = await (await pdf.getPage(1)).getTextContent();
    expect(
      original.items.map((i) => ("str" in i ? i.str : "")).join(""),
    ).toContain("ALEX MORGAN");
    const script = [...(await pdf.getJSActions())!.values()].flat().join("");
    expect(script).toContain('setTimeOut("HC_expire("+HC_generation+");",250)');
  } finally {
    await task.destroy();
  }
  const panel = fields.find((f) => f.getName().includes("_0_h_panel_0"))!;
  const cardRect = panel.acroField.getWidgets()[0].getRectangle();
  expect((cardRect.width * 96) / 72).toBeCloseTo(webCard.width, 2);
  expect((cardRect.height * 96) / 72).toBeCloseTo(webCard.height, 2);
  const ap = panel.acroField.dict.lookup(PDFName.of("AP"), PDFDict),
    ref = ap.get(PDFName.of("N"))!;
  const stream = saved.context.lookup(ref);
  if (!(stream instanceof PDFRawStream)) throw Error("Missing card appearance");
  const preview = saved.addPage([270, 315]);
  preview.node.set(
    PDFName.of("Resources"),
    stream.dict.get(PDFName.of("Resources"))!,
  );
  preview.node.set(PDFName.of("Contents"), ref);
  const previewBytes = await saved.save({ updateFieldAppearances: false });
  await page.getByRole("button", { name: "关闭窗口" }).click();
  await page.reload();
  await expect(page.locator("#title")).toHaveValue("中文图文下载测试");
  expect(requests.filter((r) => r.method !== "GET")).toEqual([]);
  expect(
    requests.filter((r) => new URL(r.url).pathname.startsWith("/api/")),
  ).toEqual([]);
  expect(errors).toEqual([]);

  // Text extraction alone cannot catch broken embedded font subsets. Render
  // the downloaded file and compare its Chinese glyph ink with the same TTF
  // drawn by Chromium, so invisible glyphs fail this regression check.
  const reader = await context.newPage();
  await reader.route("**/__pdf-check/pdf.mjs", async (r) =>
    r.fulfill({
      body: await readFile("node_modules/pdfjs-dist/build/pdf.mjs"),
      contentType: "text/javascript",
    }),
  );
  await reader.route("**/__pdf-check/data.pdf", (r) =>
    r.fulfill({
      body: Buffer.from(previewBytes),
      contentType: "application/pdf",
    }),
  );
  await reader.route("**/__pdf-check/reader", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: `<!doctype html><canvas id="pdf"></canvas><canvas id="reference"></canvas><script type="module">
    import {getDocument, GlobalWorkerOptions} from '/__pdf-check/pdf.mjs';
    GlobalWorkerOptions.workerSrc='/pdfjs/pdf.worker.min.mjs';
    const task=getDocument({url:'/__pdf-check/data.pdf',standardFontDataUrl:'/pdfjs/standard_fonts/'});
    const doc=await task.promise;
    const p=await doc.getPage(2),v=p.getViewport({scale:2});
    const canvas=document.querySelector('#pdf');canvas.width=v.width;canvas.height=v.height;
    await p.render({canvas,viewport:v}).promise;
    const font=await new FontFace('check-cjk','url(/fonts/DroidSansFallback.ttf)').load();document.fonts.add(font);
    const reference=document.querySelector('#reference');reference.width=canvas.width;reference.height=canvas.height;
    const ctx=reference.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,reference.width,reference.height);
    ctx.font='28px check-cjk';ctx.fillStyle='#6099a9';ctx.fillText('中文图文下载测试',28,60);
    const ink=(c)=>{const d=c.getContext('2d').getImageData(28,20,Math.ceil(ctx.measureText('中文图文下载测试').width),50).data;let n=0;for(let i=0;i<d.length;i+=4)if((d[i]+d[i+1]+d[i+2])/3<200)n++;return n};
    window.inkRatio=ink(canvas)/ink(reference);
  </script>`,
    }),
  );
  await reader.goto("/__pdf-check/reader");
  await reader.waitForFunction(
    () =>
      typeof (window as unknown as { inkRatio?: number }).inkRatio === "number",
  );
  const ratio = await reader.evaluate(
    () => (window as unknown as { inkRatio: number }).inkRatio,
  );
  expect(ratio).toBeGreaterThan(0.8);
  expect(ratio).toBeLessThan(1.3);
  await reader.close();
  await checkNativePdfTransfer(browser, bytes, false);
  await checkNativePdfTransfer(browser, bytes, true);
});
