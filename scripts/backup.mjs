import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
const r = spawnSync(
  "docker",
  [
    "exec",
    "hovercv-postgres",
    "pg_dump",
    "-U",
    "hovercv",
    "-d",
    "hovercv",
    "--clean",
    "--if-exists",
  ],
  { encoding: "utf8", maxBuffer: 100 * 1024 * 1024 },
);
if (r.status) throw Error("数据库备份失败");
await mkdir(".data/backups", { recursive: true, mode: 0o700 });
await writeFile(".data/backups/postgres.sql", r.stdout, { mode: 0o600 });
console.log(
  "数据库备份已保存到被 Git 忽略的 .data/backups/postgres.sql；请同时备份私有存储。",
);
