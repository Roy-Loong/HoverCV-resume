import { Pool } from "pg";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { ZodError } from "zod";
const globalDb = globalThis as unknown as {
  hovercvPool?: Pool;
  hovercvAuth?: ReturnType<typeof betterAuth>;
};
export function db() {
  if (!process.env.DATABASE_URL) throw new HttpError(503, "云端数据库尚未配置");
  return (globalDb.hovercvPool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 8,
  }));
}
export function getAuth() {
  if (!process.env.BETTER_AUTH_SECRET || !process.env.BETTER_AUTH_URL)
    throw new HttpError(503, "作者认证尚未配置");
  return (globalDb.hovercvAuth ??= betterAuth<BetterAuthOptions>({
    database: db(),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    rateLimit: { enabled: true, window: 60, max: 30, storage: "database" },
    advanced: {
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.BETTER_AUTH_URL.startsWith("https:"),
      },
    },
  }));
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function owner(req: Request) {
  const s = await getAuth().api.getSession({ headers: req.headers });
  if (!s) throw new HttpError(401, "请登录作者账户");
  return s.user.id;
}
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const expected = process.env.BETTER_AUTH_URL;
  if (
    !origin ||
    origin !== (expected ? new URL(expected).origin : new URL(req.url).origin)
  )
    throw new HttpError(403, "请求来源不被允许");
}
export async function jsonBody(req: Request, max = 64 * 1024 * 1024) {
  if (Number(req.headers.get("content-length") || 0) > max)
    throw new HttpError(413, "请求过大");
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, "缺少请求内容");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new HttpError(413, "请求过大");
    }
    chunks.push(value);
  }
  const b = new Uint8Array(size);
  let n = 0;
  for (const c of chunks) {
    b.set(c, n);
    n += c.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(b));
  } catch {
    throw new HttpError(400, "JSON 格式错误");
  }
}
export function api(fn: (req: Request, ctx: any) => Promise<Response>) {
  return async (req: Request, ctx: any) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof HttpError)
        return Response.json({ error: e.message }, { status: e.status });
      if (e instanceof ZodError)
        return Response.json(
          {
            error:
              "数据校验失败：" +
              e.issues
                .slice(0, 3)
                .map((i) => i.message)
                .join("；"),
          },
          { status: 400 },
        );
      console.error(
        "Request failed:",
        e instanceof Error ? e.name : "UnknownError",
      );
      return Response.json(
        { error: "服务暂时不可用，请稍后重试；原有内容未被覆盖。" },
        { status: 500 },
      );
    }
  };
}
export async function quota(userId: string, action: string, limit: number) {
  const slot =
    action + ":" + new Date().toISOString().slice(0, action === "ai" ? 10 : 13);
  const r = await db().query(
    "INSERT INTO quotas (user_id,slot,used) VALUES ($1,$2,1) ON CONFLICT (user_id,slot) DO UPDATE SET used=quotas.used+1 WHERE quotas.used < $3 RETURNING used",
    [userId, slot, limit],
  );
  if (!r.rowCount) throw new HttpError(429, "已达到使用额度，请稍后再试");
}
export async function ownedProject(id: string, userId: string) {
  const r = await db().query(
    "SELECT * FROM projects WHERE id=$1 AND owner_id=$2",
    [id, userId],
  );
  if (!r.rowCount) throw new HttpError(404, "项目不存在或无权访问");
  return r.rows[0] as {
    id: string;
    owner_id: string;
    revision: number;
    object_key: string;
  };
}
