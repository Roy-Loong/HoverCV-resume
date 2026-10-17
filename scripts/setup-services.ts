import { spawnSync } from "node:child_process";
async function main() {
  let ready = false;
  for (let i = 0; i < 30; i++) {
    const r = spawnSync(
      "node",
      ["--import", "tsx", "scripts/init-storage.ts"],
      { stdio: "inherit" },
    );
    if (r.status === 0) {
      ready = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!ready) throw Error("存储未就绪");
  const r = spawnSync("npm", ["run", "db:migrate"], { stdio: "inherit" });
  process.exitCode = r.status || 0;
}
main().catch(() => {
  process.exitCode = 1;
});
