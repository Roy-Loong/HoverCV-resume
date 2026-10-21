import { expect, test, type Browser } from "@playwright/test";
import { createServer } from "node:http";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFString,
  decodePDFRawStream,
} from "pdf-lib";

/** Exercise the downloaded PDF in Chromium's real PDF plugin, not PDF.js. */
export async function checkNativePdfTransfer(
  browser: Browser,
  input: Uint8Array,
  withoutScripts: boolean | "timeout-disabled" | "reverse-order",
) {
  const doc = await PDFDocument.load(input);
  if (withoutScripts === true || withoutScripts === "timeout-disabled") {
    const seen = new Set<unknown>();
    function strip(value: unknown) {
      if (seen.has(value)) return;
      seen.add(value);
      if (value instanceof PDFRawStream) strip(value.dict);
      if (value instanceof PDFDict) {
        if (value.get(PDFName.of("S")) === PDFName.of("JavaScript")) {
          if (withoutScripts === true)
            value.set(PDFName.of("JS"), PDFString.of(""));
          else {
            const source = doc.context.lookup(value.get(PDFName.of("JS")));
            const script =
              source instanceof PDFRawStream
                ? new TextDecoder().decode(decodePDFRawStream(source).decode())
                : source instanceof PDFString
                  ? source.decodeText()
                  : "";
            const replacement = script.replaceAll(
              "app.setTimeOut(",
              "(function(){return 0;})(",
            );
            value.set(
              PDFName.of("JS"),
              source instanceof PDFRawStream
                ? doc.context.register(doc.context.flateStream(replacement))
                : PDFString.of(replacement),
            );
          }
        }
        // Exercise the compatibility path where read-only widgets do not
        // receive pointer events. This is a simulation, not a WPS app test.
        const flags = value.get(PDFName.of("Ff"));
        if (flags instanceof PDFNumber && flags.asNumber() & 1)
          value.delete(PDFName.of("AA"));
        for (const [, child] of value.entries()) strip(child);
      } else if (value instanceof PDFArray) {
        for (const child of value.asArray()) strip(child);
      }
    }
    for (const [, object] of doc.context.enumerateIndirectObjects())
      strip(object);
  }
  if (withoutScripts === "reverse-order") {
    // WPS and PDFium can choose opposite ends of the annotation array when
    // controls overlap. Both orders must leave arrow hit areas unobstructed.
    for (const p of doc.getPages()) {
      const annotations = p.node.Annots();
      if (annotations)
        p.node.set(
          PDFName.of("Annots"),
          doc.context.obj(annotations.asArray().reverse()),
        );
    }
    const fields = doc
      .getForm()
      .acroForm.dict.lookup(PDFName.of("Fields"), PDFArray);
    doc
      .getForm()
      .acroForm.dict.set(
        PDFName.of("Fields"),
        doc.context.obj(fields.asArray().reverse()),
      );
  }
  const fields = doc.getForm().getFields();
  const rect = (suffix: string) =>
    fields
      .find((f) => f.getName().endsWith(suffix))!
      .acroField.getWidgets()[0]
      .getRectangle();
  const source = rect("_0_hover_0"),
    next = rect("_0_h_0_next"),
    prev = rect("_0_h_0_prev");
  const pieces = fields
    .filter((f) => /_0_h_(?:panel_0(?:_part_\d+)?|0_.+)$/.test(f.getName()))
    .map((f) => f.acroField.getWidgets()[0].getRectangle());
  const x = Math.min(...pieces.map((r) => r.x)),
    y = Math.min(...pieces.map((r) => r.y));
  const card = {
    x,
    y,
    width: Math.max(...pieces.map((r) => r.x + r.width)) - x,
    height: Math.max(...pieces.map((r) => r.y + r.height)) - y,
  };
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
    expect(
      second.equals(closed),
      "Next must not merely close or blank the card",
    ).toBe(false);
    expect(second.equals(opened), "The next image must visibly change").toBe(
      false,
    );
    await move(body);
    expect(
      (await capture()).equals(second),
      "Entering the panel must retain the selected image",
    ).toBe(true);
    // Stateful repeated navigation requires PDF scripting. The fully stripped
    // file exercises only the existing native first-next and close fallback.
    if (withoutScripts !== true) {
      const prevPoint = point(
        prev.x + prev.width / 2,
        prev.y + prev.height / 2,
      );
      await move(prevPoint);
      await page.mouse.click(prevPoint.x, prevPoint.y);
      await page.waitForTimeout(400);
      expect(
        (await capture()).equals(opened),
        `Previous must restore the first image (mode=${withoutScripts})`,
      ).toBe(true);
      await move(nextPoint);
      await page.mouse.click(nextPoint.x, nextPoint.y);
      await page.waitForTimeout(400);
      expect(
        (await capture()).equals(second),
        "Next must work again after going back",
      ).toBe(true);
    }
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
    // The old bounding rectangle incorrectly kept cards open in this blank
    // strip beside their body. Test close-by exits, including after a click.
    // PDFium expands widget hit boxes around the visual border; move 4 pt
    // beyond that reader-owned tolerance, while staying close to the card.
    for (const exit of withoutScripts === true
      ? []
      : [
          point(card.x - 4, card.y + card.height / 2),
          point(card.x + card.width + 4, card.y + card.height / 2),
          point(card.x + card.width / 2, card.y - 4),
        ]) {
      await move(word);
      await page.mouse.click(word.x, word.y);
      await move(body);
      expect((await capture()).equals(closed)).toBe(false);
      await page.mouse.move(exit.x, exit.y);
      await page.waitForTimeout(250);
      const afterExit = await capture();
      if (!afterExit.equals(closed)) {
        await test
          .info()
          .attach("exit-250", { body: afterExit, contentType: "image/png" });
        await test
          .info()
          .attach("exit-reference", { body: closed, contentType: "image/png" });
        await page.waitForTimeout(1000);
        await test.info().attach("exit-late", {
          body: await capture(),
          contentType: "image/png",
        });
      }
      expect(
        afterExit.equals(closed),
        `Card must close within 250 ms even after clicking it (mode=${withoutScripts}, exit=${JSON.stringify(exit)})`,
      ).toBe(true);
    }
  } finally {
    await context.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
