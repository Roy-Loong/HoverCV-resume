import { spawnSync } from "node:child_process";

// This flag is compiled into the browser bundle; no database or login is needed.
const result = spawnSync(
  process.execPath,
  ["node_modules/next/dist/bin/next", "build"],
  {
    stdio: "inherit",
    env: { ...process.env, NEXT_PUBLIC_HOVERCV_BROWSER_ONLY: "1" },
  },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
if (!process.env.VERCEL) await import("./standalone.mjs");
