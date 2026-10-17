import { createHash, randomUUID } from "node:crypto";
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
import { getObject, putObject, deleteObject } from "@/lib/storage";
export const runtime = "nodejs";
export const GET = api(async (req, ctx) => {
  const user = await owner(req),
    { id } = await ctx.params;
  z.string().uuid().parse(id);
  const row = await ownedProject(id, user);
  return Response.json(
    { ...JSON.parse(await getObject(row.object_key)), revision: row.revision },
    { headers: { "Cache-Control": "no-store" } },
  );
});
export const PUT = api(async (req, ctx) => {
  sameOrigin(req);
  const user = await owner(req);
  await quota(user, "save", 100);
  const { id } = await ctx.params;
  z.string().uuid().parse(id);
  const p = projectSchema.parse(await jsonBody(req));
  if (id !== p.id) throw new HttpError(400, "项目编号不一致");
  if (!p.pages.length) throw new HttpError(400, "PDF 尚未完成渲染");
  const pdf = Buffer.from(p.pdfData.split(",")[1], "base64");
  if (
    pdf.subarray(0, 5).toString() !== "%PDF-" ||
    createHash("sha256").update(pdf).digest("hex") !== p.pdfHash
  )
    throw new HttpError(400, "PDF 校验失败");
  const client = await db().connect();
  let key: string | undefined;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [id]);
    const old = await client.query(
      "SELECT * FROM projects WHERE id=$1 FOR UPDATE",
      [id],
    );
    const row = old.rows[0];
    if (row && row.owner_id !== user)
      throw new HttpError(404, "项目不存在或无权访问");
    if ((row?.revision || 0) !== p.revision)
      throw new HttpError(
        409,
        "云草稿已有更新，请先备份本地项目，再恢复云草稿以合并修改",
      );
    const revision = p.revision + 1;
    key = `drafts/${user}/${id}/${randomUUID()}.json`;
    await putObject(
      key,
      JSON.stringify({ ...p, revision }),
      "application/json",
    );
    await client.query(
      "INSERT INTO projects (id,owner_id,revision,object_key) VALUES ($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET revision=$3,object_key=$4,updated_at=now()",
      [id, user, revision, key],
    );
    await client.query("COMMIT");
    if (row?.object_key) await deleteObject(row.object_key).catch(() => {});
    return Response.json({ revision });
  } catch (e) {
    await client.query("ROLLBACK");
    if (key) await deleteObject(key).catch(() => {});
    throw e;
  } finally {
    client.release();
  }
});
