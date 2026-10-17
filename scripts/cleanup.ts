import { db } from "../lib/server";
import { deleteObject } from "../lib/storage";
async function main() {
  const r = await db().query(
    "SELECT object_key FROM publications WHERE revoked_at IS NOT NULL",
  );
  let failures = 0;
  for (const row of r.rows) {
    try {
      await deleteObject(row.object_key);
    } catch {
      failures++;
    }
  }
  await db().query(
    "DELETE FROM quotas WHERE substring(slot from position(':' in slot)+1) < to_char(now()-interval '31 days','YYYY-MM-DD')",
  );
  await db().end();
  if (failures) throw Error(`${failures} 个对象清理失败，请重试`);
  console.log("已撤回对象与过期额度记录已清理");
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
