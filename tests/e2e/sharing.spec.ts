import { test, expect } from "@playwright/test";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";

test("只读链接从显式发布到加密直传、独立阅读和撤回（模拟存储服务）", async ({
  page,
  browser,
  baseURL,
}) => {
  const password = "test-publish-password-only";
  let pathname = "",
    cipher = Buffer.alloc(0),
    revoked = false,
    tokenRequests = 0;
  // Chromium's network interception cannot expose streaming request bodies.
  // Materialize only the mocked Blob upload so the test can inspect its bytes.
  await page.addInitScript(() => {
    const realFetch = window.fetch;
    window.fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (
        url.startsWith("https://vercel.com/api/blob/") &&
        new Headers(init?.headers).get("x-mpu-action") === "upload" &&
        init?.body
      )
        return realFetch(input, {
          ...init,
          body: await new Response(init.body as BodyInit).arrayBuffer(),
        });
      return realFetch(input, init);
    };
  });
  await page.route("**/api/read-link", async (r) => {
    if (r.request().method() === "GET")
      return r.fulfill({ json: { enabled: true } });
    const body = r.request().postDataJSON();
    if (r.request().method() === "DELETE") {
      expect(body).toEqual({ pathname, key: password });
      revoked = true;
      return r.fulfill({ json: { revoked: true } });
    }
    tokenRequests++;
    expect(body.payload.clientPayload).toBe(password);
    pathname = body.payload.pathname;
    // Synthetic local signing key. No actual Vercel credentials or network.
    const clientToken = await generateClientTokenFromReadWriteToken({
      token: "vercel_blob_rw_teststore_not-a-real-secret",
      pathname,
      validUntil: Date.now() + 60000,
      allowedContentTypes: ["application/octet-stream"],
      maximumSizeInBytes: 64 * 1024 * 1024,
    });
    return r.fulfill({
      json: { type: "blob.generate-client-token", clientToken },
    });
  });
  await page.route("https://vercel.com/api/blob/**", async (r) => {
    const headers = r.request().headers(),
      action = headers["x-mpu-action"];
    if (action === "create")
      return r.fulfill({ json: { uploadId: "test-upload", key: pathname } });
    if (action === "upload") {
      cipher = Buffer.from(r.request().postDataBuffer()!);
      return r.fulfill({ json: { etag: "test-part" } });
    }
    expect(action).toBe("complete");
    return r.fulfill({
      json: {
        pathname,
        url: `https://test.public.blob.vercel-storage.com/${pathname}`,
        downloadUrl: `https://test.public.blob.vercel-storage.com/${pathname}?download=1`,
        contentType: "application/octet-stream",
        contentDisposition: "attachment",
      },
    });
  });
  await page.goto("/");
  await expect(page.locator(".save-status")).toContainText("已保存至本地");
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await page.getByRole("button", { name: /^手机阅读链接/ }).click();
  await expect(page.getByLabel("发布口令（网站管理员提供）")).toBeVisible();
  expect(tokenRequests).toBe(0);
  await page.getByLabel("发布口令（网站管理员提供）").fill(password);
  await page.getByRole("button", { name: "生成只读链接", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "复制阅读链接", exact: true }),
  ).toBeVisible();
  expect(tokenRequests).toBe(1);
  expect(cipher.subarray(0, 4).toString()).toBe("HCV7");
  expect(cipher.toString()).not.toContain("ALEX MORGAN");
  const link = await page.locator(".read-link-result input").inputValue();
  // The fragment is required; it never appears in Blob requests.
  expect(new URL(link).origin).toBe(baseURL);
  expect(new URL(link).hash.length).toBeGreaterThan(50);
  const readerContext = await browser.newContext();
  await readerContext.route(
    "https://test.public.blob.vercel-storage.com/**",
    (r) =>
      r.fulfill({
        status: revoked ? 404 : 200,
        body: revoked ? Buffer.alloc(0) : cipher,
        contentType: "application/octet-stream",
        headers: { "Access-Control-Allow-Origin": "*" },
      }),
  );
  const reader = await readerContext.newPage();
  await reader.goto(link);
  const frame = reader.frameLocator('iframe[title="手机交互简历"]');
  await expect(frame.locator(".hotspot").first()).toBeVisible();
  await frame.locator(".hotspot").first().click();
  await expect(frame.locator("#card")).toBeVisible();
  await page.getByRole("button", { name: "撤回", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "复制阅读链接", exact: true }),
  ).toHaveCount(0);
  await reader.reload();
  await expect(reader.locator("p[role=alert]")).toContainText("撤回");
  await readerContext.close();
});
