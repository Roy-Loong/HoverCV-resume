import { existsSync } from "node:fs";
import path from "node:path";
for (const file of [".env.local", ".env"])
  if (existsSync(file)) process.loadEnvFile(file);
// The standalone server changes cwd. Resolve private storage before importing it.
process.env.LOCAL_STORAGE_DIR = path.resolve(
  process.env.LOCAL_STORAGE_DIR || ".data/private",
);
process.env.HOSTNAME = process.env.HOVERCV_HOST || "0.0.0.0";
await import("../.next/standalone/server.js");
