import { db } from "@/lib/server";
import { z } from "zod";
export const dynamic = "force-dynamic";
export default async function Read({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let exists = false;
  if (z.string().uuid().safeParse(id).success) {
    try {
      const r = await db().query(
        "SELECT id FROM publications WHERE id=$1 AND revoked_at IS NULL",
        [id],
      );
      exists = !!r.rowCount;
    } catch {}
  }
  if (!exists)
    return (
      <main className="error-page">
        <h1>这份简历暂时无法阅读</h1>
        <p>链接可能已被作者撤回，请向作者索取最新版本。</p>
        <a href="/">了解 HoverCV</a>
      </main>
    );
  return (
    <iframe
      className="public-reader"
      title="交互简历"
      src={`/api/read/${id}`}
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
    />
  );
}
