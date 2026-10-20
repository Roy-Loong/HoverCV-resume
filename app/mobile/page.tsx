"use client";
import { useEffect, useState } from "react";
import { decryptReader } from "@/lib/read-link";

export default function MobileReader() {
  const [html, setHtml] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let controller: AbortController;
    const load = () => {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      setHtml("");
      setError("");
      void decryptReader(location.hash, signal)
        .then((value) => {
          if (!signal.aborted) setHtml(value);
        })
        .catch((e) => {
          if (!signal.aborted)
            setError(e instanceof Error ? e.message : "暂时无法读取简历");
        });
    };
    load();
    window.addEventListener("hashchange", load);
    return () => {
      controller.abort();
      window.removeEventListener("hashchange", load);
    };
  }, []);
  if (html)
    return (
      <iframe
        className="public-reader"
        title="手机交互简历"
        srcDoc={html}
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
      />
    );
  return (
    <main className="error-page">
      <h1>{error ? "暂时无法阅读" : "正在打开交互简历…"}</h1>
      <p role={error ? "alert" : "status"}>
        {error || "加载完成后，点击彩色文字查看图文说明。"}
      </p>
      {error && <a href="/">体验 HoverCV</a>}
    </main>
  );
}
