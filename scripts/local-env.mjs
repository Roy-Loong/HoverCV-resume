// Generates local-only credentials without logging them. Never commit .env.local.
import { randomBytes } from "node:crypto";
import { writeFile, access } from "node:fs/promises";
try {
  await access(".env.local");
  console.log("保留现有 .env.local");
} catch {
  await writeFile(
    ".env.local",
    `DATABASE_URL=postgresql://hovercv@localhost:5432/hovercv\nBETTER_AUTH_URL=http://localhost:3000\nBETTER_AUTH_SECRET=${randomBytes(32).toString("hex")}\nSTORAGE_DRIVER=local\nS3_ENDPOINT=http://localhost:9000\nS3_REGION=us-east-1\nS3_BUCKET=hovercv\nS3_ACCESS_KEY_ID=hovercv-local\nS3_SECRET_ACCESS_KEY=${randomBytes(24).toString("hex")}\n`,
    { mode: 0o600, flag: "wx" },
  );
  console.log("已生成本地专用配置，未输出密钥");
}
