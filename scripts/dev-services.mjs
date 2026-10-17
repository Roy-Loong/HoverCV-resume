import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
const container = "hovercv-postgres";
const inspect = spawnSync(
  "docker",
  ["inspect", "--format", "{{.State.Running}}", container],
  { encoding: "utf8" },
);
if (inspect.status !== 0) {
  const r = spawnSync(
    "docker",
    [
      "run",
      "-d",
      "--name",
      container,
      "-e",
      "POSTGRES_USER=hovercv",
      "-e",
      "POSTGRES_DB=hovercv",
      "-e",
      "POSTGRES_HOST_AUTH_METHOD=trust",
      "-p",
      "127.0.0.1:5432:5432",
      "-v",
      resolve(".data/postgres") + ":/var/lib/postgresql/data",
      "postgres:17-alpine",
    ],
    { stdio: "inherit" },
  );
  if (r.status) process.exit(r.status);
} else if (inspect.stdout.trim() !== "true") {
  const r = spawnSync("docker", ["start", container], { stdio: "inherit" });
  if (r.status) process.exit(r.status);
}
for (let i = 0; i < 40; i++) {
  const r = spawnSync(
    "docker",
    ["exec", container, "pg_isready", "-U", "hovercv", "-d", "hovercv"],
    { stdio: "ignore" },
  );
  if (r.status === 0) {
    const schema = spawnSync(
      "docker",
      [
        "exec",
        container,
        "psql",
        "-U",
        "hovercv",
        "-d",
        "hovercv",
        "-Atc",
        "SELECT to_regclass('public.projects')",
      ],
      { encoding: "utf8" },
    );
    if (schema.status !== 0) throw Error("数据库状态检查失败");
    if (!schema.stdout.trim() && existsSync(".data/backups/postgres.sql")) {
      const restore = spawnSync(
        "docker",
        [
          "exec",
          "-i",
          container,
          "psql",
          "-v",
          "ON_ERROR_STOP=1",
          "-U",
          "hovercv",
          "-d",
          "hovercv",
        ],
        {
          input: readFileSync(".data/backups/postgres.sql"),
          encoding: "utf8",
          maxBuffer: 20 * 1024 * 1024,
        },
      );
      if (restore.status !== 0) throw Error("数据库备份恢复失败");
      console.log("已在空数据库中恢复本地备份");
    }
    console.log("本地开发 PostgreSQL 已就绪（仅监听回环地址）");
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 500));
}
throw Error("数据库启动超时");
