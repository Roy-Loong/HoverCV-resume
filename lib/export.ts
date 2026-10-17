import JSZip from "jszip";
import { dataToBytes, projectSchema, type Project } from "./schema";
import { readerHtml } from "./reader";
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function exportProject(p: Project) {
  const zip = new JSZip();
  const manifest = structuredClone(p);
  zip.file("resume.pdf", dataToBytes(p.pdfData));
  const media = zip.folder("media")!;
  for (const a of p.annotations)
    for (const m of a.media)
      media.file(
        `${m.id}.${m.type === "image" ? "image" : "video"}`,
        dataToBytes(m.src),
      );
  zip.file("project.json", JSON.stringify(manifest));
  download(await zip.generateAsync({ type: "blob" }), `${p.name}.hovercv.zip`);
}
export async function importProject(file: File): Promise<Project> {
  if (file.size > 80 * 1024 * 1024) throw Error("项目文件超过 80 MB");
  const zip = await JSZip.loadAsync(file);
  const entry = zip.file("project.json");
  if (!entry) throw Error("缺少 project.json");
  const text = await new Promise<string>((resolve, reject) => {
    const stream = (
      entry as unknown as {
        internalStream(t: string): {
          on(e: string, f: (v: any) => void): any;
          resume(): void;
          pause(): void;
        };
      }
    ).internalStream("uint8array");
    const chunks: Uint8Array[] = [];
    let total = 0;
    const timer = setTimeout(() => {
      stream.pause();
      reject(Error("项目解压超时"));
    }, 15000);
    stream
      .on("data", (chunk: Uint8Array) => {
        total += chunk.length;
        if (total > 100 * 1024 * 1024) {
          stream.pause();
          clearTimeout(timer);
          reject(Error("项目内容过大"));
        } else chunks.push(chunk);
      })
      .on("error", (e: Error) => {
        clearTimeout(timer);
        reject(e);
      })
      .on("end", () => {
        clearTimeout(timer);
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
          bytes.set(c, offset);
          offset += c.length;
        }
        resolve(new TextDecoder().decode(bytes));
      });
    stream.resume();
  });
  const p = projectSchema.parse(JSON.parse(text));
  const { hashPdf } = await import("./schema");
  if ((await hashPdf(dataToBytes(p.pdfData))) !== p.pdfHash)
    throw Error("PDF 校验失败");
  return p;
}
export async function exportReader(p: Project, zipMode = false) {
  const html = readerHtml(projectSchema.parse(p));
  if (new Blob([html]).size > 25 * 1024 * 1024 && !zipMode)
    throw Error("单文件超过 25 MB，请选择离线 ZIP；视频会完整保留。");
  if (zipMode) {
    const zip = new JSZip();
    zip.file("index.html", html);
    zip.file("README.txt", "双击 index.html 即可离线阅读，无需安装工具。");
    download(
      await zip.generateAsync({ type: "blob" }),
      `${p.name}.offline.zip`,
    );
  } else
    download(
      new Blob([html], { type: "text/html;charset=utf-8" }),
      `${p.name}.html`,
    );
}
