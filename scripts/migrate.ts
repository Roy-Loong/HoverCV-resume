import { getMigrations } from "better-auth/db/migration";
import { db, getAuth } from "../lib/server";
async function main() {
  const auth = getAuth();
  const m = await getMigrations(auth.options);
  await m.runMigrations();
  await db().query(`
CREATE TABLE IF NOT EXISTS projects (id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, revision integer NOT NULL, object_key text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS publications (id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE, owner_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, revision integer NOT NULL, object_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz);
CREATE INDEX IF NOT EXISTS publications_project ON publications(project_id,owner_id);
CREATE TABLE IF NOT EXISTS quotas (user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, slot text NOT NULL, used integer NOT NULL DEFAULT 0, PRIMARY KEY(user_id,slot));
`);
  console.log("数据库迁移完成");
  await db().end();
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
