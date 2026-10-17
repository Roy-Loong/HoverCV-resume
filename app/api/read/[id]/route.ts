import { createHash } from "node:crypto";
import { z } from "zod";
import { api, db, HttpError } from "@/lib/server";
import { getObject } from "@/lib/storage";
export const runtime = "nodejs";
export const GET = api(async (_req, ctx) => {
  const { id } = await ctx.params;
  z.string().uuid().parse(id);
  const r = await db().query(
    "SELECT object_key FROM publications WHERE id=$1 AND revoked_at IS NULL",
    [id],
  );
  if (!r.rowCount) throw new HttpError(404, "此简历不存在或已被作者撤回");
  const html = await getObject(r.rows[0].object_key);
  const hashes = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(
      (m) => `'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`,
    )
    .join(" ");
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": `default-src 'none'; img-src data:; media-src data:; style-src 'unsafe-inline'; script-src ${hashes}; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox`,
    },
  });
});
