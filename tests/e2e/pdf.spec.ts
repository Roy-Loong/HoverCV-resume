import { test, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { PDFDocument, PDFDict, PDFName, PDFRawStream, PDFRef } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { checkNativePdfTransfer } from "./pdf-native-helper";

test("PDF 生成失败可重试，明确点击即可保存原页数的悬浮 PDF", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(180000);
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
  await page.mouse.move(20, 100);
  await page.locator(".hotspot").first().hover();
  await expect(page.locator(".hover-card")).toBeVisible();
  const webImage = await page.locator(".hover-card").screenshot();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback) {
      HTMLCanvasElement.prototype.toBlob = original;
      callback(null);
    };
  });
  const generate = page.getByRole("button", { name: /^悬浮交互 PDF/ });
  await generate.click();
  await expect(page.locator(".pdf-export-error")).toContainText(
    "注释卡片生成失败",
  );
  await expect(generate).toBeEnabled();
  await generate.click();
  const link = page.getByRole("link", { name: /下载悬浮交互 PDF/ });
  await expect(link).toBeVisible({ timeout: 45000 });
  await expect(link).toHaveAttribute("href", /^blob:/);
  await expect(link).toHaveAttribute("download", /_悬浮交互_v0\.7\.5\.pdf$/);
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
  expect(
    fields.filter((f) => f.getName().includes("_panel_")).length,
  ).toBeGreaterThanOrEqual(10);
  expect(fields.some((f) => f.getName().endsWith("_down"))).toBe(true);
  const task = getDocument({ data: new Uint8Array(bytes) }),
    pdf = await task.promise;
  try {
    expect(pdf.numPages).toBe(1);
    const original = await (await pdf.getPage(1)).getTextContent();
    expect(
      original.items.map((i) => ("str" in i ? i.str : "")).join(""),
    ).toContain("ALEX MORGAN");
    const script = [...(await pdf.getJSActions())!.values()].flat().join("");
    expect(script).toContain("app.setTimeOut(script,250)");
    expect(script).toContain("app.setInterval(script,250)");
    expect(fields.some((f) => f.getName().endsWith("_close"))).toBe(false);
  } finally {
    await task.destroy();
  }
  const frameFields = fields.filter((f) =>
    /_0_h_(?:panel_0(?:_part_\d+)?|0_.+)$/.test(f.getName()),
  );
  const pieces = frameFields.map((f) =>
    f.acroField.getWidgets()[0].getRectangle(),
  );
  // Reading backgrounds must not cover links or arrow buttons in either
  // annotation order. A full-card background was blocking clicks in WPS.
  for (let i = 0; i < pieces.length; i++)
    for (let j = i + 1; j < pieces.length; j++) {
      const a = pieces[i],
        b = pieces[j];
      const area =
        Math.max(
          0,
          Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
        ) *
        Math.max(
          0,
          Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
        );
      expect(
        area,
        `${frameFields[i].getName()} overlaps ${frameFields[j].getName()}`,
      ).toBeLessThan(0.000001);
    }
  const left = Math.min(...pieces.map((r) => r.x)),
    bottom = Math.min(...pieces.map((r) => r.y));
  const width = Math.max(...pieces.map((r) => r.x + r.width)) - left;
  const height = Math.max(...pieces.map((r) => r.y + r.height)) - bottom;
  expect((width * 96) / 72).toBeCloseTo(webCard.width, 2);
  expect((height * 96) / 72).toBeCloseTo(webCard.height, 2);
  const preview = saved.addPage([width, height]);
  const objects: Record<string, PDFRef> = {},
    commands: string[] = [];
  for (let i = 0; i < frameFields.length; i++) {
    const ref = frameFields[i].acroField.dict
      .lookup(PDFName.of("AP"), PDFDict)
      .get(PDFName.of("N"))!;
    if (!(ref instanceof PDFRef)) throw Error("Missing appearance reference");
    if (!(saved.context.lookup(ref) instanceof PDFRawStream))
      throw Error("Missing card appearance");
    objects[`Tile${i}`] = ref;
    commands.push(
      `q 1 0 0 1 ${pieces[i].x - left} ${pieces[i].y - bottom} cm /Tile${i} Do Q`,
    );
  }
  preview.node.set(
    PDFName.of("Resources"),
    saved.context.obj({ XObject: objects }),
  );
  preview.node.set(
    PDFName.of("Contents"),
    saved.context.register(saved.context.flateStream(commands.join("\n"))),
  );
  const previewBytes = await saved.save({ updateFieldAppearances: false });
  await page.getByRole("button", { name: "关闭窗口" }).click();
  await page.reload();
  await expect(page.locator("#title")).toHaveValue("中文图文下载测试");
  expect(requests.filter((r) => r.method !== "GET")).toEqual([]);
  expect(
    requests.filter((r) => new URL(r.url).pathname.startsWith("/api/")),
  ).toEqual([]);
  expect(errors).toEqual([]);

  // Compare actual PDF appearance pixels with the visible web card. Checking
  // only the outer rectangle previously missed image scaling and typography.
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
    const p=await doc.getPage(2),v=p.getViewport({scale:4/3});
    const canvas=document.querySelector('#pdf');canvas.width=v.width;canvas.height=v.height;
    await p.render({canvas,viewport:v}).promise;
    const img=new Image();img.src='data:image/png;base64,${webImage.toString("base64")}';await img.decode();
    const reference=document.querySelector('#reference');reference.width=360;reference.height=420;
    const ctx=reference.getContext('2d');ctx.drawImage(img,0,0);
    const a=ctx.getImageData(0,0,360,420).data,b=canvas.getContext('2d').getImageData(0,0,360,420).data;
    let sum=0,large=0;for(let i=0;i<a.length;i+=4){const d=(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]))/3;sum+=d;if(d>60)large++;}
    window.pixelDiff={mean:sum/(360*420),large:large/(360*420)};
  </script>`,
    }),
  );
  await reader.goto("/__pdf-check/reader");
  await reader.waitForFunction(
    () => !!(window as unknown as { pixelDiff?: unknown }).pixelDiff,
  );
  const diff = await reader.evaluate(
    () =>
      (window as unknown as { pixelDiff: { mean: number; large: number } })
        .pixelDiff,
  );
  await test
    .info()
    .attach("web-card", { body: webImage, contentType: "image/png" });
  await test.info().attach("pdf-card", {
    body: await reader.locator("#pdf").screenshot(),
    contentType: "image/png",
  });
  expect(diff.mean).toBeLessThan(4);
  expect(diff.large).toBeLessThan(0.03);
  await reader.close();
  await checkNativePdfTransfer(browser, bytes, false);
  await checkNativePdfTransfer(browser, bytes, "timeout-disabled");
  await checkNativePdfTransfer(browser, bytes, true);
  await checkNativePdfTransfer(browser, bytes, "reverse-order");
});
