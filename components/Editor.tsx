"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Copy,
  FileText,
  FolderOpen,
  HelpCircle,
  ImagePlus,
  Layers,
  Link2,
  Loader2,
  Maximize,
  MousePointer2,
  Plus,
  Scan,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Type,
  Upload,
  UserRound,
  X,
  ZoomIn,
  ZoomOut,
  GripVertical,
  LogOut,
  PanelRightClose,
  Undo2,
  Redo2,
  Hand,
  PanelsTopLeft,
} from "lucide-react";
import CanvasViewport from "./CanvasViewport";
import { PanelDivider, useWorkspacePanels } from "./WorkspacePanels";
import { COLOR_PRESETS } from "@/lib/colors";
import { EditHistory } from "@/lib/edit-history";
import { APP_VERSION } from "@/lib/version";
import {
  bytesToData,
  COLORS,
  hashPdf,
  newAnnotation,
  type Annotation,
  type Media,
  type Project,
} from "@/lib/schema";
import { loadLast, saveLocal } from "@/lib/local";
import {
  download,
  exportProject,
  exportReader,
  importProject,
} from "@/lib/export";
import { readerHtml } from "@/lib/reader";
import type { PdfTool } from "./PdfViewer";
const BROWSER_ONLY = process.env.NEXT_PUBLIC_HOVERCV_BROWSER_ONLY === "1";
const PdfViewer = dynamic(() => import("./PdfViewer"), {
  ssr: false,
  loading: () => <div className="pdf-loading">正在准备阅读器…</div>,
});
type Modal = "export" | "publish" | "auth" | "ai" | "help" | "preview" | null;
type User = { id: string; name: string; email: string };
type EditSnapshot = {
  name: string;
  annotations: Annotation[];
  selected: string | null;
};
const fileData = (file: File, onProgress?: (p: number) => void) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(Error("文件读取失败"));
    r.onprogress = (e) =>
      e.lengthComputable &&
      onProgress?.(Math.round((e.loaded / e.total) * 100));
    r.readAsDataURL(file);
  });
function demoImage(theme: number) {
  const c = document.createElement("canvas");
  c.width = 900;
  c.height = 540;
  const x = c.getContext("2d")!;
  x.fillStyle = ["#e9e3f5", "#e2ece6", "#eee6dc"][theme];
  x.fillRect(0, 0, 900, 540);
  x.fillStyle = "#fff";
  x.beginPath();
  x.roundRect(115, 62, 670, 415, 16);
  x.fill();
  x.fillStyle = "#f5f4f7";
  x.fillRect(115, 62, 160, 415);
  x.fillStyle = "#6958d5";
  x.beginPath();
  x.arc(146, 92, 7, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = "#33303c";
  x.font = "bold 16px sans-serif";
  x.fillText(["bloom", "lumen", "northstar"][theme], 165, 98);
  for (let i = 0; i < 5; i++) {
    x.fillStyle = i === 1 ? "#e6e0f7" : "#e9e7ec";
    x.fillRect(138, 135 + i * 35, 108, 17);
  }
  x.fillStyle = "#292831";
  x.font = "bold 28px sans-serif";
  x.fillText(
    ["Make room for focus.", "Ideas come together.", "A little more clarity."][
      theme
    ],
    310,
    141,
  );
  x.font = "14px sans-serif";
  x.fillStyle = "#8a8591";
  x.fillText("A fictional product design exploration", 310, 170);
  for (let i = 0; i < 3; i++) {
    x.fillStyle = ["#f1eafa", "#e8efe9", "#f6eee2"][i];
    x.beginPath();
    x.roundRect(310 + i * 142, 208, 125, 175, 10);
    x.fill();
    x.fillStyle = ["#9a80bd", "#7ca493", "#c4a27b"][i];
    x.beginPath();
    x.arc(371 + i * 142, 265, 30, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = "#fff";
    x.fillRect(328 + i * 142, 320, 90, 7);
    x.fillRect(328 + i * 142, 338, 60, 5);
  }
  return c.toDataURL("image/png");
}
export default function Editor() {
  const panels = useWorkspacePanels();
  const [project, setProject] = useState<Project | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [tool, setTool] = useState<PdfTool>("text"),
    [zoom, setZoom] = useState(0.9),
    [tab, setTab] = useState<"content" | "style">("content"),
    [modal, setModal] = useState<Modal>(null),
    [busy, setBusy] = useState(""),
    [notice, setNotice] = useState(""),
    [saved, setSaved] = useState(false),
    [rendering, setRendering] = useState(true),
    [historyCounts, setHistoryCounts] = useState({ undo: 0, redo: 0 }),
    [user, setUser] = useState<User | null>(null),
    [mobilePanel, setMobilePanel] = useState(false),
    [config, setConfig] = useState({ ai: false, cloud: false }),
    [share, setShare] = useState(""),
    [publications, setPublications] = useState<
      { id: string; created_at: string }[]
    >([]),
    [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-up"),
    [authError, setAuthError] = useState(""),
    [aiDraft, setAiDraft] = useState<{
      body: string;
      citations: { title: string; url: string }[];
      searchedAt: string;
      images: { url: string; source: string }[];
    } | null>(null),
    [aiQuery, setAiQuery] = useState(""),
    [aiContext, setAiContext] = useState(""),
    [progress, setProgress] = useState(0),
    [adjustId, setAdjustId] = useState<string | null>(null),
    [aiTarget, setAiTarget] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null),
    importRef = useRef<HTMLInputElement>(null),
    mediaRef = useRef<HTMLInputElement>(null),
    replaceRef = useRef<HTMLInputElement>(null),
    replaceId = useRef<string | null>(null),
    request = useRef<AbortController | null>(null);
  const projectRef = useRef(project);
  const history = useRef(new EditHistory<EditSnapshot>());
  projectRef.current = project;
  const a = project?.annotations.find((a) => a.id === selected) || null;
  const themePage = project?.pages.find((p) => p.hasTheme);
  const recommendedColor = themePage?.themeColor || COLORS[0];
  const notify = useCallback((s: string) => setNotice(s), []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(t);
  }, [notice]);
  const loadDemo = useCallback(async () => {
    setBusy("正在准备演示简历");
    try {
      const bytes = new Uint8Array(
        await (await fetch("/demo.pdf")).arrayBuffer(),
      );
      const first = newAnnotation(
        1,
        [[78, 528, 173, 544]],
        "Lumen Studio",
        "text",
      );
      Object.assign(first, {
        title: "Lumen Studio",
        body: "一个虚构的创意协作产品设计项目。\n\n从发现问题、梳理工作流程，到建立组件系统，我希望让团队更轻松地把想法变为作品。\n\n这里展示的是演示内容，你可以替换为自己的真实经历与作品。",
        template: "gallery",
        media: [0, 1, 2].map((i) => ({
          id: crypto.randomUUID(),
          type: "image",
          src: demoImage(i),
          caption: [
            "产品界面 · 虚构设计练习",
            "协作工作台 · 虚构设计练习",
            "视觉探索 · 虚构设计练习",
          ][i],
        })),
        links: [
          {
            label: "了解 HoverCV 设计参考",
            url: "https://github.com/VoltAgent/awesome-design-md",
          },
        ],
      });
      const second = newAnnotation(
        1,
        [[78, 257, 298, 274]],
        "Bloom / A calmer way to work",
        "text",
      );
      Object.assign(second, {
        title: "Bloom · 专注工作，从容生活",
        body: "一个关于专注和节奏的虚构设计探索。\n\n悬停在彩色标记上，即可读到简历纸面之外的故事。请将这些内容替换成你的真实作品。",
        color: COLORS[1],
        template: "cover",
        media: [
          {
            id: crypto.randomUUID(),
            type: "image",
            src: demoImage(0),
            caption: "原创示意图，非真实项目",
          },
        ],
      });
      const third = newAnnotation(
        1,
        [[78, 130, 264, 146]],
        "Communication Design",
        "text",
      );
      Object.assign(third, {
        title: "关于设计学习",
        body: "此处可补充课程、毕业作品或相关证书。演示院校为虚构内容。",
        color: COLORS[2],
      });
      const p: Project = {
        schemaVersion: 1,
        id: crypto.randomUUID(),
        name: "我的交互简历",
        pdfName: "Alex_Morgan_Resume.pdf",
        pdfData: bytesToData(bytes, "application/pdf"),
        pdfHash: await hashPdf(bytes),
        annotations: [first, second, third],
        updatedAt: new Date().toISOString(),
        revision: 0,
        pages: [],
      };
      setProject(p);
      setSelected(first.id);
      setTool("text");
      setSaved(false);
    } catch (e) {
      notify(String(e));
    } finally {
      setBusy("");
    }
  }, [notify]);
  useEffect(() => {
    void (async () => {
      try {
        const old = await loadLast();
        if (old) {
          setProject(old);
          setSelected(old.annotations[0]?.id || null);
        } else await loadDemo();
      } catch {
        await loadDemo();
      }
    })();
    if (BROWSER_ONLY) return;
    void fetch("/api/health")
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => {});
    void fetch("/api/auth/get-session")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => s?.user && setUser(s.user))
      .catch(() => {});
  }, [loadDemo]);
  useEffect(() => {
    if (!project?.pages.length) return;
    setSaved(false);
    const t = setTimeout(() => {
      saveLocal(project)
        .then(() => setSaved(true))
        .catch(() =>
          notify(
            "本地保存失败，可能是浏览器存储空间不足，请导出项目 ZIP 备份。",
          ),
        );
    }, 650);
    return () => clearTimeout(t);
  }, [project, notify]);
  useEffect(() => {
    function leave(e: BeforeUnloadEvent) {
      if (projectRef.current?.pages.length && !saved) {
        e.preventDefault();
      }
    }
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [saved]);
  useEffect(() => {
    history.current.clear();
    setHistoryCounts(history.current.counts);
  }, [project?.id]);
  function snapshot(p: Project): EditSnapshot {
    return { name: p.name, annotations: p.annotations, selected };
  }
  function mutate(fn: (p: Project) => Project, group = "") {
    const current = projectRef.current;
    if (!current) return;
    history.current.record(snapshot(current), group);
    const next = { ...fn(current), updatedAt: new Date().toISOString() };
    projectRef.current = next;
    setProject(next);
    setSaved(false);
    setHistoryCounts(history.current.counts);
  }
  function travelHistory(direction: "undo" | "redo") {
    const current = projectRef.current;
    if (!current) return;
    const previous = history.current[direction](snapshot(current));
    if (!previous) return;
    const next = {
      ...current,
      name: previous.name,
      annotations: previous.annotations,
      updatedAt: new Date().toISOString(),
    };
    projectRef.current = next;
    setProject(next);
    setSelected(previous.selected);
    setAdjustId(null);
    setSaved(false);
    setHistoryCounts(history.current.counts);
    notify(direction === "undo" ? "已撤销上一步" : "已恢复上一步");
  }
  function removeAnnotation(id: string) {
    mutate((p) => ({
      ...p,
      annotations: p.annotations.filter((n) => n.id !== id),
    }));
    if (selected === id) setSelected(null);
    setAdjustId(null);
    notify("已删除注释，点击上方“撤销”即可恢复");
  }
  function patch(updates: Partial<Annotation>) {
    if (!a) return;
    mutate(
      (p) => ({
        ...p,
        annotations: p.annotations.map((n) =>
          n.id === a.id ? { ...n, ...updates } : n,
        ),
      }),
      `${a.id}:${Object.keys(updates).sort().join(",")}`,
    );
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (modal) return;
      const target = e.target as HTMLElement;
      // Text fields keep the browser's native caret, delete and undo behavior.
      if (target.closest("input,textarea,select,[contenteditable=true]"))
        return;
      const command = e.ctrlKey || e.metaKey;
      if (command && e.key.toLowerCase() === "z") {
        e.preventDefault();
        travelHistory(e.shiftKey ? "redo" : "undo");
      } else if (command && e.key.toLowerCase() === "y") {
        e.preventDefault();
        travelHistory("redo");
      } else if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        removeAnnotation(selected);
      } else if (e.key === "Escape") setAdjustId(null);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });
  const onPages = useCallback((pages: Project["pages"]) => {
    setProject((p) => (p ? { ...p, pages } : p));
  }, []);
  function onAdd(n: Annotation) {
    panels.openInspector();
    if (adjustId) {
      mutate((p) => ({
        ...p,
        annotations: p.annotations.map((a) =>
          a.id === adjustId
            ? {
                ...a,
                page: n.page,
                kind: n.kind,
                rects: n.rects,
                text: n.text || a.text,
                context: n.context || a.context,
              }
            : a,
        ),
      }));
      setSelected(adjustId);
      setAdjustId(null);
      notify("定位已更新，内容已保留");
    } else {
      n.color = recommendedColor;
      mutate((p) => ({ ...p, annotations: [...p.annotations, n] }));
      setSelected(n.id);
    }
    setMobilePanel(true);
    setTab("content");
  }
  async function upload(file?: File) {
    if (!file) return;
    if (
      project &&
      !confirm(
        "上传新 PDF 会创建新项目；当前项目已自动保存，建议先导出项目 ZIP 备份。继续？",
      )
    )
      return;
    if (file.size > 20 * 1024 * 1024) return notify("PDF 最大支持 20 MB");
    setBusy("正在读取 PDF");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-")
        throw Error("请选择有效 PDF 文件");
      setSaved(false);
      setProject({
        schemaVersion: 1,
        id: crypto.randomUUID(),
        name: file.name.replace(/\.pdf$/i, ""),
        pdfName: file.name,
        pdfHash: await hashPdf(bytes),
        pdfData: bytesToData(bytes, "application/pdf"),
        annotations: [],
        updatedAt: new Date().toISOString(),
        revision: 0,
        pages: [],
      });
      setSelected(null);
      setAdjustId(null);
      notify("PDF 已导入。拖选文字或切换框选工具，创建第一个注释。");
    } catch (e) {
      notify(String(e));
    } finally {
      setBusy("");
      if (uploadRef.current) uploadRef.current.value = "";
    }
  }
  async function mediaFiles(files: FileList | null, replace = false) {
    if (!files || !a) return;
    setBusy("正在导入素材");
    setProgress(0);
    try {
      const output: Media[] = [];
      for (const f of Array.from(files)) {
        if (!/^image\/(png|jpeg|webp|gif)$|^video\/(mp4|webm)$/.test(f.type))
          throw Error("支持 PNG/JPG/WebP/GIF 图片和 MP4/WebM 视频");
        if (f.size > 10 * 1024 * 1024) throw Error("单个素材最大 10 MB");
        output.push({
          id:
            replace && replaceId.current
              ? replaceId.current
              : crypto.randomUUID(),
          type: f.type.startsWith("image") ? "image" : "video",
          src: await fileData(f, setProgress),
          caption: f.name,
        });
      }
      const media = replace
        ? a.media.map((m) => (m.id === replaceId.current ? output[0] : m))
        : [...a.media, ...output];
      if (media.length > 30) throw Error("最多支持 30 个素材");
      if (
        JSON.stringify({
          ...project,
          annotations: project!.annotations.map((n) =>
            n.id === a.id ? { ...n, media } : n,
          ),
        }).length >
        60 * 1024 * 1024
      )
        throw Error("项目超过 60 MB，请缩小素材后导入");
      patch({ media });
      notify("素材已添加");
    } catch (e) {
      notify(String(e));
    } finally {
      setBusy("");
      if (mediaRef.current) mediaRef.current.value = "";
      if (replaceRef.current) replaceRef.current.value = "";
    }
  }
  async function perform(fn: () => Promise<void>, label: string) {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }
  async function cloudSave(p: Project) {
    const r = await fetch("/api/projects/" + p.id, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    });
    const out = await r.json();
    if (!r.ok) throw Error(out.error || "保存失败");
    setProject((cur) => (cur ? { ...cur, revision: out.revision } : cur));
    return { ...p, revision: out.revision };
  }
  async function publish() {
    if (!project) return;
    if (!user) {
      setModal("auth");
      return;
    }
    await perform(async () => {
      const p = await cloudSave(project);
      const r = await fetch("/api/publish/" + p.id, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: p.revision }),
      });
      const out = await r.json();
      if (!r.ok) throw Error(out.error || "发布失败");
      setShare(window.location.origin + "/read/" + out.id);
      setPublications((prev) => [
        { id: out.id, created_at: new Date().toISOString() },
        ...prev,
      ]);
      notify("已发布独立快照。后续修改需要重新发布。");
    }, "正在生成发布快照");
  }
  async function auth(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setAuthError("");
    setBusy("正在连接账户");
    try {
      const r = await fetch(
        "/api/auth/" +
          (authMode === "sign-up" ? "sign-up/email" : "sign-in/email"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: data.get("name") || "作者",
            email: data.get("email"),
            password: data.get("password"),
          }),
        },
      );
      const out = await r.json();
      if (!r.ok) throw Error(out.message || "登录失败");
      setUser(out.user);
      setModal("publish");
      notify("账户已连接，你可以保存草稿并发布");
    } catch (e) {
      setAuthError(String(e));
    } finally {
      setBusy("");
    }
  }
  async function aiSearch() {
    if (!a) return;
    setAiDraft(null);
    setAiTarget(a.id);
    request.current = new AbortController();
    await perform(async () => {
      const r = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: aiQuery, context: aiContext }),
        signal: request.current!.signal,
      });
      const out = await r.json();
      if (!r.ok) throw Error(out.error || "搜索失败");
      setAiDraft(out);
    }, "正在检索真实来源并生成草稿");
  }
  useEffect(() => {
    if (modal !== "publish" || !user || !project) return;
    void fetch("/api/publish/" + project.id)
      .then((r) => (r.ok ? r.json() : []))
      .then((v) => Array.isArray(v) && setPublications(v))
      .catch(() => {});
  }, [modal, user, project?.id]);
  useEffect(() => {
    if (!modal) return;
    const old = document.activeElement as HTMLElement | null;
    const timer = setTimeout(
      () =>
        document
          .querySelector<HTMLElement>(".modal button,.modal input")
          ?.focus(),
      50,
    );
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        request.current?.abort();
        setModal(null);
      }
      if (e.key === "Tab") {
        const nodes = Array.from(
          document.querySelectorAll<HTMLElement>(
            ".modal button:not(:disabled),.modal a[href],.modal input,.modal textarea,.modal iframe",
          ),
        ).filter((n) => n.offsetParent !== null);
        const first = nodes[0],
          last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", key);
      old?.focus();
    };
  }, [modal]);
  return (
    <div
      ref={panels.shellRef}
      className={`app-shell ${panels.className}`}
      style={panels.style}
    >
      <input
        ref={uploadRef}
        type="file"
        accept="application/pdf"
        hidden
        onChange={(e) => void upload(e.target.files?.[0])}
      />
      <input
        ref={importRef}
        type="file"
        accept=".zip"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f)
            void perform(async () => {
              const p = await importProject(f);
              setProject(p);
              setSelected(p.annotations[0]?.id || null);
              notify("可编辑项目已恢复");
            }, "正在恢复项目");
        }}
      />
      <input
        ref={mediaRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm"
        multiple
        hidden
        onChange={(e) => void mediaFiles(e.target.files)}
      />
      <input
        ref={replaceRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm"
        hidden
        onChange={(e) => void mediaFiles(e.target.files, true)}
      />
      <header className="topbar">
        <a className="brand" href="/" aria-label="HoverCV 首页">
          <span className="brand-symbol">
            <MousePointer2 size={22} fill="currentColor" />
          </span>
          Hover<span>CV</span>
          <span className="beta">v{APP_VERSION}</span>
        </a>
        <div className="breadcrumbs">
          工作空间 <ChevronRight size={12} />
          <span>{project?.name || "新建简历"}</span>
        </div>
        <div className="top-actions">
          <span className="save-status">
            <span className={saved ? "status-dot" : ""} />
            {rendering
              ? "正在更新高清预览…"
              : saved
                ? "已保存至本地"
                : "准备保存…"}
          </span>
          <button
            className="btn btn-primary upload-primary"
            onClick={() => uploadRef.current?.click()}
          >
            <Upload size={16} /> 上传 PDF
          </button>
          <button
            className="icon-btn help-top"
            aria-label="使用帮助"
            onClick={() => setModal("help")}
          >
            <HelpCircle size={18} />
          </button>
          <button
            className="btn btn-quiet"
            onClick={() => setModal("preview")}
            disabled={!project?.pages.length || rendering}
          >
            <BookOpen size={15} />
            阅读预览
          </button>
          <button
            className={`btn ${BROWSER_ONLY ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setModal("export")}
            disabled={!project?.pages.length || rendering}
          >
            <ArrowDownToLine size={15} />
            导出
          </button>
          {!BROWSER_ONLY && (
            <button
              className="btn btn-primary"
              onClick={() => {
                setShare("");
                setModal("publish");
              }}
              disabled={!project?.pages.length || rendering}
            >
              <ArrowUpRight size={16} />
              发布简历
            </button>
          )}
        </div>
      </header>
      <aside className="sidebar" id="project-sidebar">
        <div className="workspace-label">
          <span className="workspace-avatar">H</span>
          <div>
            <strong>我的工作空间</strong>
            <small>让每段经历都有回响</small>
          </div>
          <ChevronDown size={13} />
        </div>
        <div className="sidebar-section">
          <div className="section-label">
            项目文件{" "}
            <button
              className="icon-btn"
              title="更换项目 PDF"
              onClick={() => uploadRef.current?.click()}
            >
              <Plus size={15} />
            </button>
          </div>
          <button
            className="file-entry"
            onClick={() => uploadRef.current?.click()}
          >
            <div className="pdf-icon">
              <FileText size={19} />
              <span>PDF</span>
            </div>
            <div>
              <strong>{project?.pdfName || "上传你的简历.pdf"}</strong>
              <small>{project?.pages.length || "–"} 页 · 原始排版</small>
            </div>
            <Check size={14} />
          </button>
          <button
            className="sidebar-upload"
            onClick={() => uploadRef.current?.click()}
          >
            <Upload size={13} />
            更换 / 上传 PDF
          </button>
        </div>
        <div className="sidebar-section annotation-section">
          <div className="section-label">
            注释列表{" "}
            <span className="count">
              {String(project?.annotations.length || 0).padStart(2, "0")}
            </span>
          </div>
          <div className="annotation-list">
            {project?.annotations.map((n, i) => (
              <div
                className={`annotation-row ${selected === n.id ? "active" : ""}`}
                key={n.id}
              >
                <button
                  key={n.id}
                  className={`annotation-item ${n.id === selected ? "active" : ""}`}
                  onClick={() => {
                    setSelected(n.id);
                    panels.openInspector();
                    setMobilePanel(true);
                    document
                      .querySelector(`[data-page="${n.page}"]`)
                      ?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                >
                  <span
                    className="annotation-number"
                    style={{ color: n.color, background: n.color + "12" }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span>
                    <strong>{n.title || "新的区域注释"}</strong>
                    <small>
                      第 {n.page} 页 ·{" "}
                      {n.media.length ? "图文卡片" : "文字卡片"}
                    </small>
                  </span>
                  <ChevronRight size={13} />
                </button>
                <button
                  className="annotation-delete icon-btn"
                  aria-label={`删除注释：${n.title}`}
                  title="删除这条注释（可撤销）"
                  onClick={() => removeAnnotation(n.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <button
            className="add-annotation"
            onClick={() => {
              setTool("text");
              notify(
                "在 PDF 中拖选一段文字，即可创建注释；扫描内容请使用框选。",
              );
            }}
          >
            <Plus size={15} />
            添加注释
          </button>
        </div>
        <div className="sidebar-bottom">
          <div className="privacy-note">
            <ShieldCheck size={17} />
            <div>
              你的内容，由你掌控
              <p>
                {BROWSER_ONLY
                  ? "浏览器内编辑，导出即可分享"
                  : "本地自动保存，发布前仅你可见"}
              </p>
            </div>
          </div>
          <button
            className="sidebar-link"
            onClick={() => importRef.current?.click()}
          >
            <FolderOpen size={15} />
            恢复项目 ZIP
            <ArrowUpRight size={13} />
          </button>
          <button className="sidebar-link" onClick={() => setModal("help")}>
            <HelpCircle size={15} />
            使用指南 <span>?</span>
          </button>
          <div className="account-row">
            <span className="avatar">
              <UserRound size={17} />
            </span>
            <div>
              <strong>{user?.name || "本地创作者"}</strong>
              <small>{user ? "已连接作者账户" : "无需登录，开始创作"}</small>
            </div>
            {!BROWSER_ONLY && (
              <button
                className="icon-btn"
                aria-label={user ? "退出登录" : "登录账户"}
                onClick={() => {
                  if (user)
                    void fetch("/api/auth/sign-out", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: "{}",
                    }).then(() => setUser(null));
                  else setModal("auth");
                }}
              >
                {user ? <LogOut size={16} /> : <Settings2 size={16} />}
              </button>
            )}
          </div>
        </div>
      </aside>
      <PanelDivider
        side="left"
        width={panels.left}
        max={panels.maximums.left}
        collapsed={panels.preferences.leftCollapsed}
        onResize={(w) => panels.resize("left", w)}
        onToggle={() => panels.toggle("left")}
        onReset={() => panels.resetSide("left")}
      />
      <main className="workspace">
        <div className="workspace-heading">
          <div>
            <h1>
              <button
                className="project-name"
                title="修改简历名称"
                onClick={() => {
                  const name = prompt(
                    "简历名称",
                    project?.name || "我的交互简历",
                  );
                  if (name?.trim())
                    mutate((p) => ({ ...p, name: name.trim().slice(0, 150) }));
                }}
              >
                {project?.name || "我的交互简历"}
              </button>
              <span className="draft-tag">草稿</span>
            </h1>
          </div>
          <div className="workspace-heading-actions">
            <button
              className="layout-reset icon-btn"
              aria-label="恢复默认布局"
              title="恢复两侧面板的默认宽度"
              onClick={panels.reset}
            >
              <PanelsTopLeft size={16} />
            </button>
            <button
              className="btn btn-quiet mobile-inspect"
              onClick={() => setMobilePanel(!mobilePanel)}
            >
              <Settings2 size={16} />
              注释
            </button>
            <button
              className="demo-reset"
              onClick={() => {
                if (confirm("重新打开虚构演示项目？请先导出当前项目备份。"))
                  void loadDemo();
              }}
            >
              体验示例
              <ArrowUpRight size={13} />
            </button>
          </div>
        </div>
        <div className="canvas-toolbar">
          <div className="tool-tabs" role="toolbar" aria-label="PDF 工具">
            <button
              className={tool === "text" ? "active" : ""}
              onClick={() => setTool("text")}
              title="拖选文字创建注释"
              aria-label="选择文字"
            >
              <MousePointer2 size={15} />
              <span>选择文字</span>
            </button>
            <button
              className={tool === "area" ? "active" : ""}
              onClick={() => setTool("area")}
              title="框选图片或扫描区域"
              aria-label="框选区域"
            >
              <Scan size={16} />
              <span>框选区域</span>
            </button>
            <button
              className={tool === "pan" ? "active" : ""}
              aria-label="拖动画布"
              title="拖动画布；也可按住空格或鼠标中键临时拖动"
              onClick={() => setTool("pan")}
            >
              <Hand size={15} />
              <span>拖动</span>
            </button>
            <span className="toolbar-divider" />
            <button
              className={tool === "read" ? "active" : ""}
              onClick={() => setTool("read")}
              aria-label="阅读"
            >
              <BookOpen size={15} />
              <span>阅读</span>
            </button>
          </div>
          <div
            className="history-controls"
            role="toolbar"
            aria-label="撤销与删除"
          >
            <button
              title="撤销（Ctrl+Z）"
              aria-label="撤销"
              disabled={!historyCounts.undo}
              onClick={() => travelHistory("undo")}
            >
              <Undo2 size={15} />
              <span>撤销</span>
            </button>
            <button
              title="重做（Ctrl+Shift+Z / Ctrl+Y）"
              aria-label="重做"
              disabled={!historyCounts.redo}
              onClick={() => travelHistory("redo")}
            >
              <Redo2 size={15} />
              <span>重做</span>
            </button>
            <button
              className="danger"
              title="删除所选注释（Delete，可撤销）"
              aria-label="删除所选注释"
              disabled={!a}
              onClick={() => a && removeAnnotation(a.id)}
            >
              <Trash2 size={15} />
              <span>删除</span>
            </button>
          </div>
          <div className="zoom-controls">
            <button
              className="icon-btn"
              aria-label="缩小"
              onClick={() =>
                setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(1)))
              }
            >
              <ZoomOut size={15} />
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button
              className="icon-btn"
              aria-label="放大"
              onClick={() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(1)))}
            >
              <ZoomIn size={15} />
            </button>
            <span className="toolbar-divider" />
            <button
              className="icon-btn"
              aria-label="适合宽度"
              onClick={() => {
                const el = document.querySelector(".document-canvas");
                if (el)
                  setZoom(
                    Math.min(
                      1.2,
                      Math.max(
                        0.4,
                        (el.clientWidth - 64) /
                          (project?.pages[0]?.width || 595),
                      ),
                    ),
                  );
              }}
            >
              <Maximize size={15} />
            </button>
          </div>
        </div>
        <CanvasViewport
          tool={tool}
          zoom={zoom}
          onZoom={setZoom}
          onUpload={(file) => void upload(file)}
        >
          <div
            className="canvas-hint"
            title="拖动两侧分隔线调整面板宽度；按住空格或鼠标中键拖动画布；Ctrl/⌘ + 滚轮或触控板双指捏合缩放"
          >
            <span className="hint-icon">
              <Sparkles size={13} />
            </span>
            <span className="canvas-help">
              {adjustId
                ? "重新选择定位区域，原有内容将保留"
                : tool === "pan"
                  ? "按住鼠标拖动画布 · Ctrl + 滚轮缩放"
                  : tool === "read"
                    ? "悬停彩色标记，看看简历背后的故事"
                    : tool === "area"
                      ? "拖出矩形框，标记图片或扫描区域 · 不执行 OCR"
                      : "拖选文字添加注释 · 空格拖动，Ctrl + 滚轮缩放"}
            </span>
            <span className="demo-pill">
              {project?.pdfName === "Alex_Morgan_Resume.pdf"
                ? "虚构示例"
                : "本地文档"}
            </span>
          </div>
          {project && (
            <PdfViewer
              project={project}
              zoom={zoom}
              tool={tool}
              selected={selected}
              onSelect={(id) => {
                setSelected(id);
                setMobilePanel(true);
                panels.openInspector();
              }}
              onAdd={onAdd}
              onPages={onPages}
              onError={notify}
              onRenderState={setRendering}
            />
          )}
          <div className="canvas-bottom">
            <ShieldCheck size={12} /> 原 PDF 排版始终保留 · 注释不会修改底稿
          </div>
        </CanvasViewport>
        <footer className="workspace-footer">
          <span>
            <span className="status-dot" />
            所有更改自动保存在此浏览器
          </span>
          <span>
            {project?.annotations.length || 0} 个注释 <i>·</i>{" "}
            {project?.pages.length || 0} 页
          </span>
        </footer>
      </main>
      <PanelDivider
        side="right"
        width={panels.right}
        max={panels.maximums.right}
        collapsed={panels.preferences.rightCollapsed}
        onResize={(w) => panels.resize("right", w)}
        onToggle={() => panels.toggle("right")}
        onReset={() => panels.resetSide("right")}
      />
      <aside
        className={`inspector ${mobilePanel ? "mobile-open" : ""}`}
        id="annotation-inspector"
      >
        <div className="inspector-heading">
          <div>
            <Settings2 size={16} />
            <strong>注释设置</strong>
          </div>
          <button
            className="icon-btn"
            aria-label="关闭设置"
            onClick={() => {
              setMobilePanel(false);
              if (window.matchMedia("(min-width: 761px)").matches)
                panels.toggle("right");
            }}
          >
            <PanelRightClose size={16} />
          </button>
        </div>
        {a ? (
          <>
            <div className="selected-summary">
              <span style={{ background: a.color + "12", color: a.color }}>
                <Type size={18} />
              </span>
              <div>
                <strong>{a.text || "手动框选区域"}</strong>
                <small>
                  第 {a.page} 页 · {a.kind === "text" ? "文字注释" : "区域注释"}
                </small>
              </div>
            </div>
            <div className="inspector-tabs">
              <button
                className={tab === "content" ? "active" : ""}
                onClick={() => setTab("content")}
              >
                内容编辑
              </button>
              <button
                className={tab === "style" ? "active" : ""}
                onClick={() => setTab("style")}
              >
                卡片样式
              </button>
            </div>
            <div className="inspector-scroll">
              {tab === "content" ? (
                <>
                  <label className="field-label" htmlFor="title">
                    卡片标题 <span>必填</span>
                  </label>
                  <input
                    id="title"
                    maxLength={200}
                    value={a.title}
                    onBlur={() => {
                      if (!a.title.trim())
                        patch({ title: a.text.slice(0, 80) || "新的区域注释" });
                    }}
                    onChange={(e) => patch({ title: e.target.value })}
                    placeholder="给这段经历一个标题"
                  />
                  <div className="label-row">
                    <label className="field-label" htmlFor="body">
                      补充说明
                    </label>
                    <span>{a.body.length} / 15000</span>
                  </div>
                  <textarea
                    id="body"
                    maxLength={15000}
                    className="body-editor"
                    value={a.body}
                    onChange={(e) => patch({ body: e.target.value })}
                    placeholder="聊聊这段经历，补充简历上写不下的故事…"
                  />
                  {!BROWSER_ONLY && (
                    <button
                      className="ai-button"
                      onClick={() => {
                        setAiDraft(null);
                        setAiQuery(a.text || a.title);
                        setAiContext(a.context);
                        setModal("ai");
                      }}
                    >
                      <Sparkles size={14} />
                      AI 帮我补充
                      <ArrowUpRight size={13} />
                    </button>
                  )}
                  <div className="field-divider" />
                  <div className="label-row">
                    <span className="field-label">图片与视频</span>
                    <span>{a.media.length} / 30</span>
                  </div>
                  <div className="media-list">
                    {a.media.map((m, i) => (
                      <div
                        key={m.id}
                        className="media-item"
                        draggable
                        onDragStart={(e) =>
                          e.dataTransfer.setData(
                            "text/hovercv-media",
                            String(i),
                          )
                        }
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          const from = Number(
                            e.dataTransfer.getData("text/hovercv-media"),
                          );
                          if (
                            !Number.isInteger(from) ||
                            from < 0 ||
                            from >= a.media.length
                          )
                            return;
                          const list = [...a.media];
                          list.splice(i, 0, list.splice(from, 1)[0]);
                          patch({ media: list });
                        }}
                      >
                        <GripVertical size={12} />
                        {m.type === "image" ? (
                          <img src={m.src} alt={m.caption} />
                        ) : (
                          <span className="video-thumb">▶</span>
                        )}
                        <div>
                          <input
                            aria-label={`素材 ${i + 1} 说明`}
                            value={m.caption}
                            maxLength={500}
                            onChange={(e) =>
                              patch({
                                media: a.media.map((n) =>
                                  n.id === m.id
                                    ? { ...n, caption: e.target.value }
                                    : n,
                                ),
                              })
                            }
                          />
                          <div className="media-actions">
                            <button
                              onClick={() => {
                                replaceId.current = m.id;
                                replaceRef.current?.click();
                              }}
                            >
                              替换
                            </button>
                            <button
                              aria-label="素材上移"
                              disabled={i === 0}
                              onClick={() => {
                                const list = [...a.media];
                                [list[i - 1], list[i]] = [list[i], list[i - 1]];
                                patch({ media: list });
                              }}
                            >
                              ↑
                            </button>
                            <button
                              aria-label="素材下移"
                              disabled={i === a.media.length - 1}
                              onClick={() => {
                                const list = [...a.media];
                                [list[i + 1], list[i]] = [list[i], list[i + 1]];
                                patch({ media: list });
                              }}
                            >
                              ↓
                            </button>
                            <button
                              aria-label={`删除素材 ${i + 1}`}
                              onClick={() =>
                                patch({
                                  media: a.media.filter((n) => n.id !== m.id),
                                })
                              }
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    className="upload-zone"
                    onClick={() => mediaRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      void mediaFiles(e.dataTransfer.files);
                    }}
                  >
                    <ImagePlus size={21} />
                    <strong>点击或拖入图片、视频</strong>
                    <small>JPG、PNG、WebP、GIF、MP4、WebM · 单个 ≤10MB</small>
                  </button>
                  <div className="field-divider" />
                  <div className="label-row">
                    <span className="field-label">相关链接</span>
                    <button
                      className="text-button"
                      onClick={() => {
                        const url = prompt("输入完整的 http(s) 链接");
                        if (!url) return;
                        try {
                          if (
                            !["https:", "http:"].includes(new URL(url).protocol)
                          )
                            throw Error();
                          patch({
                            links: [
                              ...a.links,
                              { label: prompt("链接名称") || "了解更多", url },
                            ],
                          });
                        } catch {
                          notify("请输入有效的 http(s) 链接");
                        }
                      }}
                    >
                      <Plus size={13} />
                      添加
                    </button>
                  </div>
                  {a.links.length ? (
                    a.links.map((l, i) => (
                      <div className="link-item" key={i}>
                        <Link2 size={14} />
                        <a
                          href={l.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {l.label}
                        </a>
                        <button
                          className="icon-btn"
                          aria-label="删除链接"
                          onClick={() =>
                            patch({ links: a.links.filter((_, j) => i !== j) })
                          }
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="muted-small">
                      作品链接、个人主页，或更多关于你的内容。
                    </p>
                  )}
                </>
              ) : (
                <>
                  <label className="field-label">卡片模板</label>
                  <div className="template-options">
                    {(["intro", "gallery", "cover"] as const).map((t, i) => (
                      <button
                        key={t}
                        className={a.template === t ? "selected" : ""}
                        onClick={() => patch({ template: t })}
                      >
                        <div className={`template-mini mini-${t}`}>
                          <span />
                          <i />
                          <i />
                          <i />
                        </div>
                        <span>{["简介", "图文", "封面"][i]}</span>
                        {a.template === t && <Check size={12} />}
                      </button>
                    ))}
                  </div>
                  <p className="muted-small">
                    统一 360 × 420，长内容在卡片内滚动。
                  </p>
                  <div className="field-divider" />
                  <label className="field-label">
                    文字颜色 · 12 款柔和配色
                  </label>
                  <p className="muted-small">
                    仅改变标注文字的颜色，保留原字形，不加底色和下划线。
                  </p>
                  <button
                    className="recommended-color"
                    onClick={() => patch({ color: recommendedColor })}
                  >
                    <span style={{ background: recommendedColor }} />
                    <div>
                      <strong>使用推荐颜色</strong>
                      <small>
                        {themePage ? "根据 PDF 主色调配" : "黑白简历推荐柔雾紫"}{" "}
                        · {recommendedColor}
                      </small>
                    </div>
                    <Sparkles size={16} />
                  </button>
                  <div className="color-options">
                    {COLOR_PRESETS.map(({ color: c, name }) => (
                      <button
                        key={c}
                        style={{ background: c }}
                        aria-label={"颜色 " + c}
                        title={name + " " + c}
                        aria-pressed={a.color === c}
                        onClick={() => patch({ color: c })}
                      >
                        {a.color === c && <Check size={16} />}
                      </button>
                    ))}
                    <label className="custom-color" title="自定义颜色">
                      <Plus size={17} />
                      <input
                        aria-label="自定义颜色"
                        type="color"
                        value={a.color}
                        onChange={(e) => patch({ color: e.target.value })}
                      />
                    </label>
                  </div>
                  <div className="field-divider" />
                  <label className="toggle-row">
                    <div>
                      自动轮播<small>默认手动翻图，每 3.5 秒自动切换</small>
                    </div>
                    <input
                      type="checkbox"
                      checked={a.autoplay}
                      onChange={(e) => patch({ autoplay: e.target.checked })}
                    />
                  </label>
                  <p className="muted-small">
                    操作控件或键盘聚焦时暂停；关闭卡片后停止。视频不会自动播放。
                  </p>
                  <div className="field-divider" />
                  <button
                    className="btn btn-secondary full"
                    onClick={() => {
                      setAdjustId(a.id);
                      setTool(a.kind === "text" ? "text" : "area");
                      notify("请重新选择文字或框选区域，原有注释内容会保留");
                    }}
                  >
                    <Scan size={14} />
                    重新定位此注释
                  </button>
                </>
              )}
              <div className="inspector-tip">
                <MousePointer2 size={17} />
                <p>
                  在简历上悬停彩色标记，
                  <br />
                  即时预览这张卡片。
                </p>
              </div>
            </div>
            <div className="inspector-footer">
              <span>
                <CheckCheck size={13} />
                自动保存
              </span>
              <button
                className="text-button danger"
                onClick={() => removeAnnotation(a.id)}
              >
                <Trash2 size={13} />
                删除注释
              </button>
            </div>
          </>
        ) : (
          <div className="no-selection">
            <Layers size={30} />
            <h3>为经历，多添一层</h3>
            <p>
              选择已有注释进行编辑，或在 PDF 上拖选文字、框选区域创建新注释。
            </p>
            <button
              className="btn btn-secondary"
              onClick={() => setTool("text")}
            >
              <Plus size={14} />
              开始标记
            </button>
          </div>
        )}
      </aside>
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
          <button
            className="icon-btn"
            aria-label="关闭提示"
            onClick={() => setNotice("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {busy && (
        <div className="busy-indicator" role="status">
          <Loader2 size={17} className="spin" />
          {busy}
          {progress > 0 && progress < 100 ? ` ${progress}%` : ""}
          {modal === "ai" && (
            <button onClick={() => request.current?.abort()}>取消</button>
          )}
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) {
              request.current?.abort();
              setModal(null);
            }
          }}
        >
          <section
            className={`modal ${modal === "preview" ? "preview-modal" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={
              {
                export: "导出简历",
                publish: "发布简历",
                auth: "作者账户",
                ai: "AI 检索草稿",
                help: "使用指南",
                preview: "阅读预览",
              }[modal]
            }
          >
            <button
              className="modal-close icon-btn"
              aria-label="关闭窗口"
              onClick={() => {
                request.current?.abort();
                setModal(null);
              }}
            >
              <X size={19} />
            </button>
            {modal === "export" && (
              <>
                <span className="modal-icon">
                  <ArrowDownToLine size={24} />
                </span>
                <h2>把故事，带到更多地方</h2>
                <p className="modal-description">
                  网页保留交互体验。原 PDF 仅作为底稿备份。
                </p>
                <div className="export-options">
                  <button
                    onClick={() =>
                      void perform(
                        () => exportReader(project!),
                        "正在生成独立 HTML",
                      )
                    }
                  >
                    <FileText />
                    <div>
                      <strong>独立 HTML</strong>
                      <p>双击即读，图片、视频与交互完整嵌入</p>
                    </div>
                    <ArrowUpRight size={17} />
                  </button>
                  <button
                    onClick={() =>
                      void perform(
                        () => exportReader(project!, true),
                        "正在打包离线阅读文件",
                      )
                    }
                  >
                    <FolderOpen />
                    <div>
                      <strong>离线阅读 ZIP</strong>
                      <p>超过 25 MB 时推荐，解压后打开 index.html</p>
                    </div>
                    <ArrowUpRight size={17} />
                  </button>
                  <button
                    onClick={() =>
                      void perform(
                        () => exportProject(project!),
                        "正在备份可编辑项目",
                      )
                    }
                  >
                    <Layers />
                    <div>
                      <strong>可编辑项目 ZIP</strong>
                      <p>原 PDF、注释、素材，可随时导入继续编辑</p>
                    </div>
                    <ArrowUpRight size={17} />
                  </button>
                </div>
                <div className="modal-note">
                  <ShieldCheck size={15} />
                  导出不需要账户或 AI 服务，素材不会静默丢失。
                </div>
              </>
            )}
            {modal === "preview" && (
              <>
                <h2>
                  阅读预览 <span className="draft-tag">尚未发布</span>
                </h2>
                <p className="modal-description">
                  与公开阅读、离线 HTML 使用同一阅读器。
                </p>
                {project && (
                  <iframe
                    title="独立阅读器预览"
                    sandbox="allow-scripts allow-popups"
                    srcDoc={readerHtml(project)}
                  />
                )}
              </>
            )}
            {modal === "publish" && (
              <>
                <span className="modal-icon">
                  <ArrowUpRight size={24} />
                </span>
                <h2>让好机会，看见你</h2>
                <p className="modal-description">
                  发布后生成独立快照。HR
                  无需登录即可阅读；草稿修改不会影响已发布版本。
                </p>
                {!config.cloud ? (
                  <div className="notice-box">
                    云服务尚未配置。你仍可导出独立 HTML 或离线 ZIP。自部署步骤见
                    README。
                  </div>
                ) : (
                  <>
                    <div className="publish-checks">
                      <span>
                        <Check size={15} />
                        匿名访客直接阅读
                      </span>
                      <span>
                        <Check size={15} />
                        私有存储，按发布版本授权
                      </span>
                      <span>
                        <Check size={15} />
                        随时撤回公开链接
                      </span>
                    </div>
                    <button
                      className="btn btn-primary full"
                      onClick={() => void publish()}
                      disabled={!!busy}
                    >
                      {user ? "保存草稿并发布新版本" : "登录作者账户后发布"}
                      <ArrowUpRight size={16} />
                    </button>
                    {user && (
                      <div className="cloud-actions">
                        <button
                          className="text-button"
                          onClick={() =>
                            void perform(async () => {
                              await cloudSave(project!);
                              notify("云端草稿已保存");
                            }, "正在保存草稿")
                          }
                        >
                          <Cloud size={14} />
                          仅保存云草稿
                        </button>
                        <button
                          className="text-button"
                          onClick={() =>
                            void perform(async () => {
                              const r = await fetch(
                                "/api/projects/" + project!.id,
                              );
                              const out = await r.json();
                              if (!r.ok) throw Error(out.error);
                              setProject(out);
                              setSelected(out.annotations[0]?.id || null);
                              notify("云端草稿已恢复");
                            }, "正在恢复云草稿")
                          }
                        >
                          恢复云草稿
                        </button>
                      </div>
                    )}
                  </>
                )}
                {share && (
                  <div className="share-result">
                    <label className="field-label">公开阅读链接</label>
                    <div>
                      <input value={share} readOnly />
                      <button
                        className="icon-btn"
                        aria-label="复制公开链接"
                        onClick={() =>
                          void navigator.clipboard
                            .writeText(share)
                            .then(() => notify("链接已复制"))
                        }
                      >
                        <Copy size={17} />
                      </button>
                    </div>
                    <a href={share} target="_blank" rel="noopener noreferrer">
                      打开公开阅读页
                      <ArrowUpRight size={13} />
                    </a>
                  </div>
                )}
                {publications.length > 0 && (
                  <div className="published-list">
                    <span className="field-label">已发布版本</span>
                    {publications.map((p) => (
                      <div key={p.id}>
                        <a
                          href={"/read/" + p.id}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {new Date(p.created_at).toLocaleString("zh-CN")}
                        </a>
                        <button
                          className="text-button danger"
                          onClick={() =>
                            void perform(async () => {
                              const r = await fetch(
                                "/api/publish/" +
                                  project!.id +
                                  "?snapshot=" +
                                  p.id,
                                { method: "DELETE" },
                              );
                              if (!r.ok) throw Error("撤回失败");
                              setPublications((v) =>
                                v.filter((n) => n.id !== p.id),
                              );
                              if (share.endsWith(p.id)) setShare("");
                              notify("已撤回，公开素材已清理");
                            }, "正在撤回发布")
                          }
                        >
                          撤回
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            {modal === "auth" && (
              <>
                <span className="modal-icon">
                  <UserRound size={24} />
                </span>
                <h2>{authMode === "sign-up" ? "创建作者账户" : "欢迎回来"}</h2>
                <p className="modal-description">
                  账户用于 AI、云草稿和发布。HR 阅读不需要账户。
                </p>
                {!config.cloud ? (
                  <div className="notice-box">
                    作者服务未配置，本地编辑与导出可继续使用。
                  </div>
                ) : (
                  <form onSubmit={(e) => void auth(e)}>
                    {authMode === "sign-up" && (
                      <label className="form-label">
                        称呼
                        <input
                          name="name"
                          autoComplete="name"
                          required
                          maxLength={100}
                        />
                      </label>
                    )}
                    <label className="form-label">
                      邮箱
                      <input
                        type="email"
                        name="email"
                        autoComplete="email"
                        required
                      />
                    </label>
                    <label className="form-label">
                      密码
                      <input
                        type="password"
                        name="password"
                        minLength={12}
                        maxLength={128}
                        autoComplete={
                          authMode === "sign-up"
                            ? "new-password"
                            : "current-password"
                        }
                        required
                        placeholder="至少 12 位"
                      />
                    </label>
                    {authError && (
                      <p role="alert" className="error-text">
                        {authError}
                      </p>
                    )}
                    <button className="btn btn-primary full" disabled={!!busy}>
                      {authMode === "sign-up" ? "注册并继续" : "登录"}
                    </button>
                    <button
                      className="text-button auth-switch"
                      type="button"
                      onClick={() => {
                        setAuthError("");
                        setAuthMode(
                          authMode === "sign-up" ? "sign-in" : "sign-up",
                        );
                      }}
                    >
                      {authMode === "sign-up"
                        ? "已有账户？登录"
                        : "还没有账户？注册"}
                    </button>
                  </form>
                )}
              </>
            )}
            {modal === "ai" && (
              <>
                <span className="modal-icon">
                  <Sparkles size={24} />
                </span>
                <h2>有据可循，再多说一点</h2>
                <p className="modal-description">
                  仅发送你确认的关键词和少量上下文。真实检索后生成草稿，由你决定是否采用。
                </p>
                <label className="form-label">
                  关键词
                  <input
                    value={aiQuery}
                    maxLength={160}
                    onChange={(e) => setAiQuery(e.target.value)}
                  />
                </label>
                <label className="form-label">
                  补充上下文（可删减，最多 500 字）
                  <textarea
                    value={aiContext}
                    maxLength={500}
                    onChange={(e) => setAiContext(e.target.value)}
                  />
                </label>
                {!config.ai ? (
                  <div className="notice-box">
                    <strong>AI 服务未配置</strong>
                    <p>
                      需要部署者配置模型与 Tavily
                      搜索密钥；当前没有执行联网搜索。你可以继续手工编辑，已有内容会保留。
                    </p>
                  </div>
                ) : !user ? (
                  <button
                    className="btn btn-primary full"
                    onClick={() => setModal("auth")}
                  >
                    登录作者账户以使用 AI
                  </button>
                ) : (
                  <button
                    className="btn btn-primary full"
                    disabled={!!busy || !aiQuery.trim()}
                    onClick={() => void aiSearch()}
                  >
                    <Sparkles size={15} />
                    确认并联网检索
                  </button>
                )}
                {aiDraft && (
                  <div className="ai-draft">
                    <label className="field-label">
                      可编辑草稿 · 尚未写入注释
                    </label>
                    <textarea
                      value={aiDraft.body}
                      onChange={(e) =>
                        setAiDraft({ ...aiDraft, body: e.target.value })
                      }
                    />
                    <p className="muted-small">
                      检索时间：{aiDraft.searchedAt}
                    </p>
                    {aiDraft.citations.map((c, i) => (
                      <a
                        key={i}
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        [{i + 1}] {c.title}
                        <ArrowUpRight size={12} />
                      </a>
                    ))}
                    {aiDraft.images.length > 0 && (
                      <div className="ai-images">
                        <label className="field-label">
                          检索配图 · 选择后才导入
                        </label>
                        {aiDraft.images.map((img, i) => (
                          <div key={i}>
                            <a
                              href={img.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              候选图片 {i + 1} · 来源
                            </a>
                            <button
                              className="text-button"
                              onClick={() =>
                                void perform(async () => {
                                  const r = await fetch("/api/images", {
                                    method: "POST",
                                    headers: {
                                      "Content-Type": "application/json",
                                    },
                                    body: JSON.stringify({
                                      url: img.url,
                                      source: img.source,
                                    }),
                                  });
                                  const out = await r.json();
                                  if (!r.ok) throw Error(out.error);
                                  patch({
                                    media: [
                                      ...a!.media,
                                      {
                                        id: crypto.randomUUID(),
                                        type: "image",
                                        src: out.data,
                                        caption: "来源：" + img.source,
                                      },
                                    ],
                                  });
                                  notify("图片已按你的选择导入");
                                }, "正在验证并导入图片")
                              }
                            >
                              导入
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <button
                      className="btn btn-primary full"
                      onClick={() => {
                        if (aiTarget !== selected) {
                          notify("已切换注释，请重新检索");
                          return;
                        }
                        patch({
                          body: aiDraft.body,
                          citations: aiDraft.citations,
                          searchedAt: aiDraft.searchedAt,
                        });
                        setModal(null);
                        notify("草稿已采纳，请确认内容后重新发布");
                      }}
                    >
                      确认采用草稿
                      <Check size={15} />
                    </button>
                  </div>
                )}
              </>
            )}
            {modal === "help" && (
              <>
                <span className="modal-icon">
                  <MousePointer2 size={24} />
                </span>
                <h2>简历之外，还有故事</h2>
                <p className="modal-description">
                  四步，为你的真实经历添加可交互的补充。
                </p>
                <ol className="help-steps">
                  <li>
                    <strong>上传 PDF</strong>
                    <p>保留原排版。扫描版可直接使用框选区域，无需 OCR。</p>
                  </li>
                  <li>
                    <strong>选词或框选</strong>
                    <p>
                      每个标记独立绑定页码与坐标；跨页内容请分别标记。同名词也可单独定位。
                    </p>
                  </li>
                  <li>
                    <strong>丰富卡片</strong>
                    <p>
                      添加说明、图片、视频和链接；在卡片样式里选择颜色、模板或重新定位。
                    </p>
                  </li>
                  <li>
                    <strong>
                      {BROWSER_ONLY ? "预览并导出" : "预览、导出或发布"}
                    </strong>
                    <p>
                      悬停预览。导出 HTML 可离线阅读；项目 ZIP 可导回继续编辑。
                      {!BROWSER_ONLY && "公开分享需作者账户。"}
                    </p>
                  </li>
                </ol>
                <div className="modal-note">
                  <ShieldCheck size={16} />
                  本地保存只属于当前浏览器，请定期导出项目 ZIP。
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
