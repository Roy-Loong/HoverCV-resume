import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decryptReader,
  encryptReader,
  readerLink,
  validateReaderBlobUrl,
} from "../lib/read-link";
const mocks = vi.hoisted(() => ({ handleUpload: vi.fn(), del: vi.fn() }));
vi.mock("@vercel/blob/client", () => ({ handleUpload: mocks.handleUpload }));
vi.mock("@vercel/blob", () => ({ del: mocks.del }));
import { GET, POST, DELETE } from "../app/api/read-link/route";
const pathname = "readers/12345678-1234-1234-1234-123456789abc.hcv",
  url = `https://test.public.blob.vercel-storage.com/${pathname}`;
const password = "test-publish-password-only";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});
describe("手机只读链接", () => {
  it("图文在本机加密，完整链接可解密，密钥不发送到服务器", async () => {
    const html =
        "<!doctype html><h1>虚构图文简历</h1><p>PRIVATE STORY 中文正文</p>",
      packed = await encryptReader(html);
    const bytes = await packed.blob.arrayBuffer();
    expect(new TextDecoder().decode(bytes)).not.toContain("PRIVATE STORY");
    const fetcher = vi.fn().mockImplementation(async () => new Response(bytes));
    vi.stubGlobal("fetch", fetcher);
    const link = readerLink("https://hovercv.example", url, packed.key);
    expect(link.split("#")[0]).toBe("https://hovercv.example/mobile");
    expect(await decryptReader(new URL(link).hash)).toBe(html);
    expect(fetcher).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        credentials: "omit",
        referrerPolicy: "no-referrer",
        cache: "no-store",
      }),
    );
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain(packed.key);
  });
  it("缺少密钥、错误密钥、篡改文件或已撤回都不能读取", async () => {
    const packed = await encryptReader("<p>private</p>"),
      other = await encryptReader("other"),
      bytes = new Uint8Array(await packed.blob.arrayBuffer());
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => new Response(bytes)),
    );
    await expect(decryptReader("#not-a-link")).rejects.toThrow("不完整");
    await expect(
      decryptReader(
        new URL(readerLink("https://app.example", url, other.key)).hash,
      ),
    ).rejects.toThrow("损坏");
    bytes[bytes.length - 1] ^= 1;
    await expect(
      decryptReader(
        new URL(readerLink("https://app.example", url, packed.key)).hash,
      ),
    ).rejects.toThrow("损坏");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    );
    await expect(
      decryptReader(
        new URL(readerLink("https://app.example", url, packed.key)).hash,
      ),
    ).rejects.toThrow("撤回");
  });
  it.each([
    "http://127.0.0.1/readers/a.hcv",
    "https://test.public.blob.vercel-storage.com.evil.test/a",
    "https://test.public.blob.vercel-storage.com/readers/../../bad",
    "https://test.public.blob.vercel-storage.com/anything.html",
    url + "?key=x",
  ])("拒绝外部或不合法的读取位置 %s", (value) => {
    expect(() => validateReaderBlobUrl(value)).toThrow();
  });
});
const req = (method: string, body: unknown, origin = "https://app.example") =>
  new Request("https://app.example/api/read-link", {
    method,
    headers: { "Content-Type": "application/json", origin },
    body: JSON.stringify(body),
  });
const body = (key = password, path = pathname) => ({
  type: "blob.generate-client-token",
  payload: { pathname: path, multipart: true, clientPayload: key },
});
describe("阅读链接发布权限与范围", () => {
  it("未配置服务时明确返回未启用，绝不尝试上传", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    vi.stubEnv("SHARING_PUBLISH_KEY", "");
    expect(await (await GET()).json()).toEqual({ enabled: false });
    expect((await POST(req("POST", body()), {})).status).toBe(503);
    expect(mocks.handleUpload).not.toHaveBeenCalled();
  });
  it("只有正确口令和同源请求能获取限时、限路径、限大小的上传许可", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-server-token");
    vi.stubEnv("SHARING_PUBLISH_KEY", password);
    let policy: unknown;
    mocks.handleUpload.mockImplementation(async (options) => {
      policy = await options.onBeforeGenerateToken(pathname, password, true);
      return {
        type: "blob.generate-client-token",
        clientToken: "test-client-token",
      };
    });
    expect((await POST(req("POST", body("incorrect")), {})).status).toBe(403);
    expect(
      (await POST(req("POST", body(), "https://evil.example"), {})).status,
    ).toBe(403);
    expect(
      (await POST(req("POST", body(password, "other/file.html")), {})).status,
    ).toBe(400);
    expect(mocks.handleUpload).not.toHaveBeenCalled();
    const response = await POST(req("POST", body()), {});
    expect(response.status).toBe(200);
    expect(policy).toMatchObject({
      allowedContentTypes: ["application/octet-stream"],
      maximumSizeInBytes: 64 * 1024 * 1024,
      allowOverwrite: false,
      addRandomSuffix: false,
      cacheControlMaxAge: 60,
    });
    expect(JSON.stringify(await response.json())).not.toContain(password);
  });
  it("撤回需发布口令，只删除分享目录中的指定对象", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-server-token");
    vi.stubEnv("SHARING_PUBLISH_KEY", password);
    mocks.del.mockResolvedValue(undefined);
    expect(
      (await DELETE(req("DELETE", { pathname, key: "wrong" }), {})).status,
    ).toBe(403);
    expect(
      (
        await DELETE(
          req("DELETE", { pathname: "unrelated/private.pdf", key: password }),
          {},
        )
      ).status,
    ).toBe(400);
    expect(mocks.del).not.toHaveBeenCalled();
    expect(
      (await DELETE(req("DELETE", { pathname, key: password }), {})).status,
    ).toBe(200);
    expect(mocks.del).toHaveBeenCalledExactlyOnceWith(pathname);
  });
});
