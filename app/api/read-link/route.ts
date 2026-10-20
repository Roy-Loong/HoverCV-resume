import { timingSafeEqual } from "node:crypto";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { del } from "@vercel/blob";
import { z } from "zod";
import { api, HttpError, jsonBody } from "@/lib/server";
import { READ_LINK_MAX_BYTES, readerPathPattern } from "@/lib/read-link";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function enabled() {
  return (
    !!process.env.BLOB_READ_WRITE_TOKEN &&
    (process.env.SHARING_PUBLISH_KEY?.length ?? 0) >= 16
  );
}
function authorize(req: Request, key: string) {
  if (req.headers.get("origin") !== new URL(req.url).origin)
    throw new HttpError(403, "请求来源不被允许");
  if (!enabled())
    throw new HttpError(
      503,
      "手机阅读链接服务尚未开通；PDF 和本地导出仍可使用。",
    );
  const given = Buffer.from(key),
    expected = Buffer.from(process.env.SHARING_PUBLISH_KEY!);
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    throw new HttpError(403, "发布口令不正确，请向网站管理员确认。");
}
export async function GET() {
  return Response.json(
    { enabled: enabled() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export const POST = api(async (req) => {
  const body = z
    .object({
      type: z.literal("blob.generate-client-token"),
      payload: z.object({
        pathname: z.string().regex(readerPathPattern),
        clientPayload: z.string().max(512),
        multipart: z.boolean(),
      }),
    })
    .parse(await jsonBody(req, 4096));
  authorize(req, body.payload.clientPayload);
  const result = await handleUpload({
    body: body as HandleUploadBody,
    request: req,
    onBeforeGenerateToken: async () => ({
      allowedContentTypes: ["application/octet-stream"],
      maximumSizeInBytes: READ_LINK_MAX_BYTES,
      addRandomSuffix: false,
      allowOverwrite: false,
      validUntil: Date.now() + 10 * 60 * 1000,
      cacheControlMaxAge: 60,
    }),
  });
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
});
export const DELETE = api(async (req) => {
  const body = z
    .object({
      pathname: z.string().regex(readerPathPattern),
      key: z.string().max(512),
    })
    .parse(await jsonBody(req, 4096));
  authorize(req, body.key);
  await del(body.pathname);
  return Response.json(
    { revoked: true },
    { headers: { "Cache-Control": "no-store" } },
  );
});
