// Client-only encryption. The decryption key lives in the URL fragment and
// is never sent to the application server or the Blob store.
export const READ_LINK_MAX_BYTES = 64 * 1024 * 1024;
const HTML_MAX_BYTES = 80 * 1024 * 1024;
const HEADER = new Uint8Array([72, 67, 86, 55]);
export const readerPathPattern = /^readers\/[a-f0-9-]{36}\.hcv$/;

function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
function fromBase64url(s: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(s))
    throw Error("阅读链接不完整，请重新复制整个链接。");
  return Uint8Array.from(
    atob(s.replaceAll("-", "+").replaceAll("_", "/")),
    (c) => c.charCodeAt(0),
  );
}
export function validateReaderBlobUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !/^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/.test(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !readerPathPattern.test(url.pathname.slice(1))
  )
    throw Error("阅读文件地址无效。");
  return url.href;
}
async function limitedBytes(stream: ReadableStream<Uint8Array>, max: number) {
  const reader = stream.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > max)
        throw Error("阅读文件过大，请让作者减少素材后重新分享。");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
export async function encryptReader(html: string) {
  const source = new Blob([html]);
  if (source.size > HTML_MAX_BYTES)
    throw Error("图文内容过大，请减少素材后重试。");
  const compressed = await limitedBytes(
    source.stream().pipeThrough(new CompressionStream("gzip")),
    READ_LINK_MAX_BYTES - 32,
  );
  const rawKey = crypto.getRandomValues(new Uint8Array(32)),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, [
    "encrypt",
  ]);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    compressed,
  );
  return {
    blob: new Blob([HEADER, iv, encrypted], {
      type: "application/octet-stream",
    }),
    key: base64url(rawKey),
  };
}
export function readerLink(origin: string, blobUrl: string, key: string) {
  validateReaderBlobUrl(blobUrl);
  if (fromBase64url(key).length !== 32) throw Error("阅读密钥无效。");
  return `${origin}/mobile#${base64url(new TextEncoder().encode(blobUrl))}.${key}`;
}
export async function decryptReader(hash: string, signal?: AbortSignal) {
  if (hash.length > 2048) throw Error("阅读链接格式错误，请让作者重新分享。");
  const [encoded, keyText, ...extra] = hash.replace(/^#/, "").split(".");
  if (!encoded || !keyText || extra.length)
    throw Error("阅读链接不完整，请让作者重新发送整个链接。");
  const url = validateReaderBlobUrl(
      new TextDecoder().decode(fromBase64url(encoded)),
    ),
    rawKey = fromBase64url(keyText);
  if (rawKey.length !== 32) throw Error("阅读密钥无效，请重新复制整个链接。");
  const response = await fetch(url, {
    signal,
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok || !response.body)
    throw Error("这份简历已撤回或暂时无法加载，请联系作者。");
  const bytes = await limitedBytes(response.body, READ_LINK_MAX_BYTES);
  if (bytes.length < 32 || !HEADER.every((c, i) => bytes[i] === c))
    throw Error("阅读文件格式错误。");
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, [
    "decrypt",
  ]);
  let decrypted: ArrayBuffer;
  try {
    decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(4, 16) },
      key,
      bytes.slice(16),
    );
  } catch {
    throw Error("阅读链接不完整或文件已损坏，请让作者重新分享。");
  }
  const html = await limitedBytes(
    new Blob([decrypted]).stream().pipeThrough(new DecompressionStream("gzip")),
    HTML_MAX_BYTES,
  );
  return new TextDecoder().decode(html);
}
