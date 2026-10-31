// 极简静态文件服务器（无依赖，Node.js 18+）
// 用法: node server.mjs [port] [root]
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";

const port = Number(process.argv[2] || 8766);
const root = resolve(process.argv[3] || import.meta.dirname);
const pidPath = join(root, ".server.pid");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".skysheet": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const watched = ["index.html", "app.js", "style.css"];

/** 版本戳：被监视文件的 mtime+size 组合，供前端轮询自动刷新 */
function versionStamp() {
  return watched
    .map((name) => {
      try {
        const stat = statSync(join(root, name));
        return `${name}:${Math.round(stat.mtimeMs)}:${stat.size}`;
      } catch {
        return `${name}:missing`;
      }
    })
    .join("|");
}

const server = createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/__version") {
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify({ version: versionStamp() }));
      return;
    }
    if (pathname === "/") pathname = "/index.html";
    const target = resolve(join(root, normalize(pathname)));
    if (target !== root && !target.startsWith(root + sep)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    if (!existsSync(target) || !statSync(target).isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("404 not found");
      return;
    }
    const ext = extname(target).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME[ext] || "application/octet-stream",
      "cache-control": "no-cache",
      "access-control-allow-origin": "*",
    });
    createReadStream(target).pipe(res);
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" }).end(String(error));
  }
});

server.listen(port, "127.0.0.1", () => {
  try { writeFileSync(pidPath, String(process.pid), "utf8"); } catch {}
  console.log(`Sky Studio PC 已启动: http://127.0.0.1:${port}/`);
  console.log("运行 stop.cmd 即可停止。");
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    try { unlinkSync(pidPath); } catch {}
    process.exit(0);
  });
}
