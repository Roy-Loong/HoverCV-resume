import { expect, test, type Browser } from "@playwright/test";
import { createServer } from "node:http";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFString,
} from "pdf-lib";

/** Exercise the downloaded PDF in Chromium's real PDF plugin, not PDF.js. */
export async function checkNativePdfTransfer(
  browser: Browser,
  input: Uint8Array,
  withoutScripts: boolean,
) {
  const doc = await PDFDocument.load(input);
  if (withoutScripts) {
    const seen = new Set<unknown>();
    function strip(value: unknown) {
      if (seen.has(value)) return;
      seen.add(value);
      if (value instanceof PDFRawStream) strip(value.dict);
      if (value instanceof PDFDict) {
        if (value.get(PDFName.of("S")) === PDFName.of("JavaScript"))
          value.set(PDFName.of("JS"), PDFString.of(""));
        for (const [, child] of value.entries()) strip(child);
      } else if (value instanceof PDFArray) {
        for (const child of value.asArray()) strip(child);
      }
    }
    for (const [, object] of doc.context.enumerateIndirectObjects())
      strip(object);
  }
  const fields = doc.getForm().getFields();
  const rect = (suffix: string) =>
    fields
      .find((f) => f.getName().endsWith(suffix))!
      .acroField.getWidgets()[0]
      .getRectangle();
  const source = rect("_0_hover_0"),
    card = rect("_0_h_panel_0"),
    next = rect("_0_h_0_next");
  const media = doc.getPage(0).getSize();
  const bytes = await doc.save({ updateFieldAppearances: false });
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "application/pdf");
    res.end(Buffer.from(bytes));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("Missing PDF test server");
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  });
  try {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/resume.pdf`);
    await expect
      .poll(() =>
        page.frames().some((f) => f.url().startsWith("chrome-extension:")),
      )
      .toBe(true);
    const frame = page
      .frames()
      .find((f) => f.url().startsWith("chrome-extension:"))!;
    type Viewer = HTMLElement & {
      viewport: {
        fitToPage(): void;
        getPageScreenRect(index: number): {
          x: number;
          y: number;
          width: number;
          height: number;
        };
      };
    };
    await expect
      .poll(() =>
        frame.locator("pdf-viewer").evaluate((e) => {
          try {
            return (e as Viewer).viewport.getPageScreenRect(0).width > 0;
          } catch {
            return false;
          }
        }),
      )
      .toBe(true);
    await frame
      .locator("pdf-viewer")
      .evaluate((e) => (e as Viewer).viewport.fitToPage());
    await page.waitForTimeout(700);
    const screen = await frame
      .locator("pdf-viewer")
      .evaluate((e) => (e as Viewer).viewport.getPageScreenRect(0));
    const scroller = (await frame.locator("#scroller").boundingBox())!;
    const scale = screen.width / media.width;
    const point = (x: number, y: number) => ({
      x: scroller.x + screen.x + x * scale,
      y: scroller.y + screen.y + (media.height - y) * scale,
    });
    const top = point(card.x, card.y + card.height);
    const clip = {
      x: top.x + 3,
      y: top.y + 3,
      width: card.width * scale - 6,
      // Exclude the footer controls: native keyboard focus decoration varies
      // after image navigation, independently of the visible card content.
      height: (card.height - 48) * scale - 6,
    };
    const capture = () => page.screenshot({ clip });
    const move = async (p: { x: number; y: number }) => {
      await page.mouse.move(p.x, p.y, { steps: 8 });
      await page.waitForTimeout(650); // Well beyond the 250 ms close delay.
    };
    const outside = point(2, 2);
    await move(outside);
    const closed = await capture();
    const word = point(
      source.x + source.width / 2,
      source.y + source.height / 2,
    );
    await move(word);
    const opened = await capture();
    expect(
      opened.equals(closed),
      "Hover must visibly open the real PDF card",
    ).toBe(false);
    const sx = source.x + source.width / 2,
      sy = source.y + source.height / 2;
    const cx = Math.max(card.x, Math.min(sx, card.x + card.width));
    const cy = Math.max(card.y, Math.min(sy, card.y + card.height));
    const edgeX = Math.max(source.x, Math.min(cx, source.x + source.width));
    const edgeY = Math.max(source.y, Math.min(cy, source.y + source.height));
    await move(point((edgeX + cx) / 2, (edgeY + cy) / 2));
    expect(
      (await capture()).equals(opened),
      "Pausing in the gap must retain the card",
    ).toBe(true);
    const body = point(card.x + 18, card.y + card.height / 2);
    await move(body);
    expect(
      (await capture()).equals(opened),
      "Entering the body must retain the card",
    ).toBe(true);
    const nextPoint = point(next.x + next.width / 2, next.y + next.height / 2);
    await move(nextPoint);
    await page.mouse.click(nextPoint.x, nextPoint.y);
    await page.waitForTimeout(400);
    const second = await capture();
    expect(second.equals(opened), "The next image must visibly change").toBe(
      false,
    );
    await move(body);
    expect(
      (await capture()).equals(second),
      "Entering the panel must retain the selected image",
    ).toBe(true);
    await move(outside);
    expect(
      (await capture()).equals(closed),
      "Leaving must close automatically, without clicking ×",
    ).toBe(true);
    await move(word);
    const reopened = await capture();
    if (!reopened.equals(opened)) {
      for (const [name, body] of Object.entries({
        opened,
        closed,
        second,
        reopened,
      }))
        await test
          .info()
          .attach(`${withoutScripts ? "native-only" : "scripted"}-${name}`, {
            body,
            contentType: "image/png",
          });
    }
    expect(
      reopened.equals(opened),
      "The card must reopen after automatic closing",
    ).toBe(true);
  } finally {
    await context.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
