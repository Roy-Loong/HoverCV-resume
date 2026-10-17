import { resolve4 } from "node:dns/promises";
import { request } from "node:https";
import { HttpError } from "./server";
export function publicIpv4(ip: string) {
  const p = ip.split(".").map(Number);
  return (
    p.length === 4 &&
    p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
    !(
      p[0] === 0 ||
      p[0] === 10 ||
      p[0] === 127 ||
      p[0] >= 224 ||
      (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && [0, 168].includes(p[1])) ||
      (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
      (p[0] === 198 && [18, 19, 51].includes(p[1])) ||
      (p[0] === 203 && p[1] === 0 && p[2] === 113)
    )
  );
}
export async function importImage(url: string) {
  const u = new URL(url),
    hosts = (
      process.env.IMAGE_ALLOWED_HOSTS || "images.unsplash.com,images.pexels.com"
    )
      .split(",")
      .map((s) => s.trim());
  if (
    u.protocol !== "https:" ||
    (u.port && u.port !== "443") ||
    u.username ||
    u.password ||
    !hosts.includes(u.hostname)
  )
    throw new HttpError(
      400,
      "仅支持已配置可信图片站点的 HTTPS 图片，请下载后手动上传其他来源",
    );
  const addresses = await resolve4(u.hostname);
  if (!addresses.length || addresses.some((ip) => !publicIpv4(ip)))
    throw new HttpError(400, "图片地址无法安全访问");
  const address = addresses[0];
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const timer = setTimeout(() => {
      req.destroy();
      reject(new HttpError(504, "图片导入超时"));
    }, 10000);
    const req = request(
      u,
      {
        method: "GET",
        lookup: (_hostname, opts, cb) => {
          if (opts.all) cb(null, [{ address, family: 4 }]);
          else
            (cb as unknown as (e: null, a: string, f: number) => void)(
              null,
              address,
              4,
            );
        },
        headers: { Accept: "image/png,image/jpeg,image/webp,image/gif" },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          clearTimeout(timer);
          reject(new HttpError(400, "图片来源不可用（不跟随重定向）"));
          return;
        }
        const type = String(res.headers["content-type"] || "").split(";")[0];
        if (
          !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
            type,
          ) ||
          Number(res.headers["content-length"] || 0) > 5 * 1024 * 1024
        ) {
          res.destroy();
          clearTimeout(timer);
          reject(new HttpError(400, "图片类型不支持或超过 5 MB"));
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > 5 * 1024 * 1024) {
            res.destroy();
            reject(new HttpError(413, "图片超过 5 MB"));
          } else chunks.push(chunk);
        });
        res.on("end", () => {
          clearTimeout(timer);
          const b = Buffer.concat(chunks);
          const valid =
            type === "image/png"
              ? b
                  .subarray(0, 8)
                  .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
              : type === "image/jpeg"
                ? b[0] === 255 && b[1] === 216
                : type === "image/gif"
                  ? b.subarray(0, 6).toString().startsWith("GIF8")
                  : b.subarray(0, 4).toString() === "RIFF" &&
                    b.subarray(8, 12).toString() === "WEBP";
          if (!valid) {
            reject(new HttpError(400, "图片内容与声明类型不符"));
            return;
          }
          resolve(Buffer.from(`data:${type};base64,${b.toString("base64")}`));
        });
        res.on("error", (e) => {
          clearTimeout(timer);
          reject(e);
        });
      },
    );
    req.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    req.end();
  });
  return bytes.toString();
}
