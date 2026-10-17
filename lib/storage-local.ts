import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
const base = path.resolve(
  /* turbopackIgnore: true */ process.env.LOCAL_STORAGE_DIR || ".data/private",
);
function location(key: string) {
  const p = path.resolve(base, key);
  if (!p.startsWith(base + path.sep)) throw Error("Invalid storage key");
  return p;
}
export async function putLocal(key: string, body: string) {
  const file = location(key);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, body, { mode: 0o600, flag: "wx" });
}
export async function getLocal(key: string) {
  return readFile(/* turbopackIgnore: true */ location(key), "utf8");
}
export async function deleteLocal(key: string) {
  try {
    await unlink(/* turbopackIgnore: true */ location(key));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}
