import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const portIndex = args.indexOf("--port");
const port = portIndex === -1 ? 3000 : Number(args[portIndex + 1]);
const shouldOpen = !args.includes("--no-open");
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error("端口必须是 1024–65535 之间的整数。");
  process.exit(1);
}
if (Number(process.versions.node.split(".")[0]) < 24) {
  console.error(
    "请先安装 Node.js 24 或更新版本：https://nodejs.org/zh-cn/download",
  );
  process.exit(1);
}
const address = `http://localhost:${port}`;
function openBrowser() {
  if (!shouldOpen) return;
  const command =
    process.platform === "win32"
      ? "explorer.exe"
      : process.platform === "darwin"
        ? "open"
        : "xdg-open";
  // This is a fixed loopback URL, passed as one argument without a shell.
  const browser = spawn(command, [address], { stdio: "ignore" });
  browser.on("error", () =>
    console.log(`请手动在这台电脑的浏览器输入：${address}`),
  );
}
async function runningHoverCV() {
  try {
    const r = await fetch(address, { signal: AbortSignal.timeout(1500) });
    return r.ok && (await r.text()).includes("HoverCV ·");
  } catch {
    return false;
  }
}
async function portAvailable() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (e) =>
      e.code === "EADDRINUSE" ? resolve(false) : reject(e),
    );
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}
async function install() {
  const lock = await readFile(path.join(root, "package-lock.json"));
  const fingerprint = createHash("sha256")
    .update(lock)
    .update(
      `${process.platform}/${process.arch}/${process.versions.node.split(".")[0]}`,
    )
    .digest("hex");
  const stamp = path.join(root, ".data", "local-preview-install.json");
  let previous;
  try {
    previous = JSON.parse(await readFile(stamp, "utf8"));
  } catch {}
  if (
    previous?.fingerprint === fingerprint &&
    existsSync(path.join(root, "node_modules/next/dist/bin/next")) &&
    existsSync(path.join(root, "public/pdfjs/pdf.worker.min.mjs"))
  )
    return;
  console.log(
    "首次启动正在安装运行组件，需要联网；请等待这个窗口中的安装完成。",
  );
  const status = await new Promise((resolve, reject) => {
    // Windows needs the command interpreter to invoke npm.cmd. All arguments are fixed.
    const child =
      process.platform === "win32"
        ? spawn("cmd.exe", ["/d", "/s", "/c", "npm ci"], {
            cwd: root,
            stdio: "inherit",
          })
        : spawn("npm", ["ci"], { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  if (status !== 0)
    throw Error("组件安装失败。请保留窗口中的报错，检查网络后重新启动。");
  await mkdir(path.dirname(stamp), { recursive: true });
  await writeFile(stamp, JSON.stringify({ fingerprint }));
}
async function main() {
  if (args.includes("--install-only")) {
    await install();
    console.log("运行组件已准备好。");
    return;
  }
  if (!(await portAvailable())) {
    if (await runningHoverCV()) {
      console.log(`HoverCV 已在运行。请在这台电脑的浏览器输入：${address}`);
      openBrowser();
      return;
    }
    throw Error(
      `${port} 端口正在被其他程序使用。请关闭该程序，或在终端运行 node scripts/local-preview.mjs --port 3001。不同端口的浏览器本地项目相互独立。`,
    );
  }
  await install();
  console.log("\n正在启动 HoverCV。本窗口请保持打开，按 Ctrl+C 停止。");
  const child = spawn(
    process.execPath,
    [
      path.join(root, "node_modules/next/dist/bin/next"),
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    { cwd: root, stdio: "inherit" },
  );
  let finished = false,
    attempts = 0,
    checking = false;
  const timer = setInterval(async () => {
    if (checking || finished) return;
    checking = true;
    try {
      if (await runningHoverCV()) {
        clearInterval(timer);
        console.log(`\nHoverCV 已就绪。请在这台电脑的浏览器输入：${address}`);
        console.log("先试试示例，再点击“更换 / 上传 PDF”导入你的简历。");
        openBrowser();
      } else if (++attempts >= 60) {
        clearInterval(timer);
        console.log("启动耗时较长，请查看上方输出；窗口中的服务仍在运行。");
      }
    } finally {
      checking = false;
    }
  }, 1000);
  const stop = (signal) => {
    if (!finished) child.kill(signal);
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
  child.once("error", (e) => {
    clearInterval(timer);
    finished = true;
    console.error("启动失败：" + e.message);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    clearInterval(timer);
    finished = true;
    process.exitCode =
      signal === "SIGINT" || signal === "SIGTERM" ? 0 : (code ?? 1);
  });
}
main().catch((e) => {
  console.error("\n" + e.message);
  process.exitCode = 1;
});
