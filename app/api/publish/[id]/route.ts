import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  api,
  db,
  HttpError,
  jsonBody,
  owner,
  ownedProject,
  quota,
  sameOrigin,
} from "@/lib/server";
import { projectSchema } from "@/lib/schema";
import { readerHtml } from "@/lib/reader";
import { getObject, putObject, deleteObject } from "@/lib/storage";
export const runtime = "nodejs";
export const GET = api(async (req, ctx) => {
  const user = await owner(req),
    { id } = await ctx.params;
  z.string().uuid().parse(id);
  await ownedProject(id, user);
  const r = await db().query(
    "SELECT id,created_at FROM publications WHERE project_id=$1 AND owner_id=$2 AND revoked_at IS NULL ORDER BY created_at DESC",
    [id, user],
  );
  return Response.json(r.rows, { headers: { "Cache-Control": "no-store" } });
});
export const POST = api(async (req, ctx) => {
  sameOrigin(req);
  const user = await owner(req);
  await quota(user, "publish", 20);
  const { id } = await ctx.params;
  z.string().uuid().parse(id);
  const { revision } = z
    .object({ revision: z.number().int() })
    .parse(await jsonBody(req, 4096));
  const row = await ownedProject(id, user);
  if (row.revision !== revision)
    throw new HttpError(409, "草稿版本已变化，请重新保存后发布");
  const p = projectSchema.parse(JSON.parse(await getObject(row.object_key)));
  const snapshot = randomUUID(),
    key = `publications/${user}/${snapshot}.html`;
  await putObject(key, readerHtml(p), "text/html; charset=utf-8");
  try {
    await db().query(
      "INSERT INTO publications (id,project_id,owner_id,revision,object_key) VALUES ($1,$2,$3,$4,$5)",
      [snapshot, id, user, revision, key],
    );
  } catch (e) {
    await deleteObject(key).catch(() => {});
    throw e;
  }
  return Response.json({ id: snapshot, revision });
});
export const DELETE = api(async (req, ctx) => {
  sameOrigin(req);
  const user = await owner(req),
    { id } = await ctx.params;
  z.string().uuid().parse(id);
  const snapshot = z
    .string()
    .uuid()
    .parse(new URL(req.url).searchParams.get("snapshot"));
  const r = await db().query(
    "UPDATE publications SET revoked_at=now() WHERE id=$1 AND project_id=$2 AND owner_id=$3 AND revoked_at IS NULL RETURNING object_key",
    [snapshot, id, user],
  );
  if (!r.rowCount) throw new HttpError(404, "发布版本不存在");
  await deleteObject(r.rows[0].object_key);
  return Response.json({ revoked: true });
});
