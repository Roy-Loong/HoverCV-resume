"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, FileText, Loader2 } from "lucide-react";
import type { Project } from "@/lib/schema";

export default function PdfDownloadOption({ project }: { project: Project }) {
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    url: string;
    name: string;
    pages: number;
    size: number;
  } | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(
    () => () => {
      if (result) URL.revokeObjectURL(result.url);
    },
    [result],
  );
  async function prepare() {
    if (progress) return;
    setError("");
    setProgress("正在准备 PDF…");
    const request = new AbortController();
    controller.current = request;
    try {
      const { buildInteractivePdf } = await import("@/lib/pdf-export");
      const pdf = await buildInteractivePdf(
        project,
        setProgress,
        request.signal,
      );
      request.signal.throwIfAborted();
      setResult({
        url: URL.createObjectURL(pdf.blob),
        name: pdf.filename,
        pages: pdf.pages,
        size: pdf.blob.size,
      });
    } catch (e) {
      if (!request.signal.aborted)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!request.signal.aborted) setProgress("");
    }
  }
  return (
    <>
      {result ? (
        <a
          className="pdf-download-ready"
          href={result.url}
          download={result.name}
        >
          <ArrowDownToLine />
          <div>
            <strong>下载交互 PDF</strong>
            <p>
              已生成 · {result.pages} 页 ·{" "}
              {(result.size / 1024 / 1024).toFixed(1)} MB · 点击保存到电脑
            </p>
          </div>
          <ArrowDownToLine size={17} />
        </a>
      ) : (
        <button onClick={() => void prepare()} disabled={!!progress}>
          {progress ? <Loader2 className="spin" /> : <FileText />}
          <div>
            <strong>{progress ? "正在生成交互 PDF" : "交互 PDF"}</strong>
            <p>
              {progress || "点击彩色文字查看图文、返回简历，便于作为文件转发"}
            </p>
          </div>
          <ArrowDownToLine size={17} />
        </button>
      )}
      {error && (
        <p className="pdf-export-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <p className="pdf-export-hint" role="status">
          PDF 已在浏览器内生成。点击上方“下载交互
          PDF”即可保存；微信内预览可能限制跳转，可用 WPS 或 Acrobat 打开。
        </p>
      )}
    </>
  );
}
