import { z } from "zod";
import { api, jsonBody, owner, quota, sameOrigin } from "@/lib/server";
import { safeUrl } from "@/lib/schema";
import { importImage } from "@/lib/image-import";
export const runtime = "nodejs";
export const POST = api(async (req) => {
  sameOrigin(req);
  const user = await owner(req);
  await quota(user, "image", 30);
  const { url } = z
    .object({ url: safeUrl, source: safeUrl })
    .parse(await jsonBody(req, 8192));
  return Response.json({ data: await importImage(url) });
});
