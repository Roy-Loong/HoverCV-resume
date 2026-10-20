"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Copy,
  Link2,
  Loader2,
  Smartphone,
  Trash2,
} from "lucide-react";
import type { Project } from "@/lib/schema";
import { encryptReader, readerLink } from "@/lib/read-link";
import { readerHtml } from "@/lib/reader";

type SavedLink = { url: string; pathname: string; name: string };
const STORAGE_KEY = "hovercv:read-links";
export default function MobileReadLink({ project }: { project: Project }) {
  const [open, setOpen] = useState(false),
    [enabled, setEnabled] = useState<boolean | null>(null),
    [password, setPassword] = useState(""),
    [progress, setProgress] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [links, setLinks] = useState<SavedLink[]>([]);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (Array.isArray(saved))
        setLinks(
          saved
            .filter(
              (l) =>
                typeof l.url === "string" &&
                typeof l.pathname === "string" &&
                typeof l.name === "string",
            )
            .slice(0, 10),
        );
    } catch {}
    return () => request.current?.abort();
  }, []);
  const remember = (items: SavedLink[]) => {
    setLinks(items);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {}
  };
  async function expand() {
    setOpen((v) => !v);
    if (open) return;
    setError("");
    try {
      const response = await fetch("/api/read-link", { cache: "no-store" });
      if (!response.ok) throw Error("暂时无法检查阅读链接服务，请稍后重试。");
      setEnabled((await response.json()).enabled === true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  async function create() {
    if (progress) return;
    setError("");
    setMessage("");
    setProgress("正在加密图文…");
    const controller = new AbortController();
    let active = true;
    request.current = controller;
    try {
      const packed = await encryptReader(readerHtml(project));
      controller.signal.throwIfAborted();
      const { upload } = await import("@vercel/blob/client");
      setProgress("正在上传加密图文…");
      const result = await upload(
        `readers/${crypto.randomUUID()}.hcv`,
        packed.blob,
        {
          access: "public",
          handleUploadUrl: "/api/read-link",
          clientPayload: password,
          contentType: "application/octet-stream",
          multipart: true,
          abortSignal: controller.signal,
          onUploadProgress: ({ percentage }) => {
            if (active && !controller.signal.aborted)
              setProgress(`正在上传加密图文 ${Math.round(percentage)}%`);
          },
        },
      );
      const url = readerLink(location.origin, result.url, packed.key);
      remember(
        [
          { url, pathname: result.pathname, name: project.name },
          ...links,
        ].slice(0, 10),
      );
      setMessage(
        "阅读链接已生成。复制完整链接，与 PDF 一起发给 HR；修改后请重新生成。",
      );
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          e instanceof Error && /client token/i.test(e.message)
            ? "无法获取上传许可，请确认发布口令及阅读链接服务已开通。"
            : e instanceof Error
              ? e.message
              : String(e),
        );
    } finally {
      active = false;
      if (!controller.signal.aborted) setProgress("");
    }
  }
  async function revoke(link: SavedLink) {
    if (progress) return;
    setError("");
    setMessage("");
    setProgress("正在撤回链接…");
    try {
      const response = await fetch("/api/read-link", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pathname: link.pathname, key: password }),
      });
      if (!response.ok)
        throw Error((await response.json()).error || "撤回失败，请重试。");
      remember(links.filter((l) => l.pathname !== link.pathname));
      setMessage("链接已撤回，缓存最多约 1 分钟后失效；已保存的副本不受影响。");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress("");
    }
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setMessage("链接已复制。");
    } catch {
      setMessage("请在链接输入框中全选并复制。");
    }
  }
  return (
    <>
      <button onClick={() => void expand()} aria-expanded={open}>
        <Smartphone />
        <div>
          <strong>手机阅读链接</strong>
          <p>保留 PDF，另附一个手机点击看图文的网页链接</p>
        </div>
        <ArrowUpRight size={17} />
      </button>
      {open && (
        <section className="mobile-share" aria-label="手机阅读链接设置">
          {enabled === null && !error && <p role="status">正在检查链接服务…</p>}
          {enabled === false && (
            <p role="status">
              手机阅读链接服务尚未开通。当前仍可下载
              PDF，或复制下方体验网址邀请朋友使用编辑器。
            </p>
          )}
          {enabled === true && (
            <>
              <p>
                将当前图文版本加密后上传，持有完整链接的人可以阅读。HR
                无需登录；你的编辑稿仍保存在本机。
              </p>
              <label htmlFor="share-password">发布口令（网站管理员提供）</label>
              <input
                id="share-password"
                type="password"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                maxLength={512}
              />
              <button
                className="btn btn-primary"
                onClick={() => void create()}
                disabled={!!progress || password.length < 16}
              >
                {progress ? (
                  <Loader2 className="spin" size={15} />
                ) : (
                  <Link2 size={15} />
                )}{" "}
                {progress || "生成只读链接"}
              </button>
            </>
          )}
          {links.map((link) => (
            <div className="read-link-result" key={link.pathname}>
              <strong>{link.name}</strong>
              <input
                aria-label={`${link.name}的阅读链接`}
                value={link.url}
                readOnly
                onFocus={(e) => e.target.select()}
              />
              <div>
                <button
                  className="btn btn-secondary"
                  onClick={() => void copy(link.url)}
                >
                  <Copy size={14} /> 复制阅读链接
                </button>
                <a
                  className="btn btn-quiet"
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  打开阅读
                </a>
                {enabled && (
                  <button
                    className="btn btn-quiet"
                    onClick={() => void revoke(link)}
                    disabled={!!progress || password.length < 16}
                  >
                    <Trash2 size={14} /> 撤回
                  </button>
                )}
              </div>
            </div>
          ))}
          <div className="read-link-result">
            <strong>邀请朋友体验编辑器</strong>
            <p>朋友打开后可上传自己的 PDF；这个网址不会分享你的简历。</p>
            <button
              className="btn btn-secondary"
              onClick={() => void copy(location.origin + "/")}
            >
              <Copy size={14} /> 复制体验网址
            </button>
          </div>
          {message && <p role="status">{message}</p>}
          {error && (
            <p className="pdf-export-error" role="alert">
              {error}
            </p>
          )}
        </section>
      )}
    </>
  );
}
