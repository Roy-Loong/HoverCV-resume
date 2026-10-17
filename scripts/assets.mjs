import { cp, mkdir } from "node:fs/promises";
await mkdir("public/pdfjs", { recursive: true });
for (const [from, to] of [
  ["build/pdf.worker.min.mjs", "pdf.worker.min.mjs"],
  ["cmaps", "cmaps"],
  ["standard_fonts", "standard_fonts"],
  ["wasm", "wasm"],
])
  await cp(`node_modules/pdfjs-dist/${from}`, `public/pdfjs/${to}`, {
    recursive: true,
  });
