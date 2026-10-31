// 启动/停止/查看 Sky Studio PC 的后台服务（脱离控制台独立运行）
import { spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createConnection } from "node:net";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "server.mjs");
const pidPath = join(here, ".server.pid");
const port = Number(process.argv[3] || 8766);
const action = (process.argv[2] || "status").toLowerCase();

const pidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const readPid = () => {
  try {
    const pid = Number(readFileSync(pidPath, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
};

const portOpen = () =>
  new Promise((resolvePromise) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(800);
    socket.once("connect", () => { socket.destroy(); resolvePromise(true); });
    socket.once("timeout", () => { socket.destroy(); resolvePromise(false); });
    socket.once("error", () => resolvePromise(false));
  });

const start = async () => {
  if (await portOpen()) {
    console.log(`服务已在运行: http://127.0.0.1:${port}/`);
    return;
  }
  const pid = readPid();
  if (pid && pidAlive(pid)) {
    console.log(`发现残留进程 PID ${pid}，先结束它`);
    try { process.kill(pid); } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  const child = spawn(process.execPath, [serverPath, String(port)], {
    detached: true,
    stdio: "ignore",
    cwd: here,
    windowsHide: true,
  });
  child.unref();
  if (child.pid) writeFileSync(pidPath, String(child.pid), "utf8");
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 150));
    if (await portOpen()) {
      console.log(`已启动: http://127.0.0.1:${port}/ (PID ${child.pid})`);
      return;
    }
  }
  console.error("启动超时，请检查 Node 是否可用");
  process.exitCode = 1;
};

const stop = async () => {
  const pid = readPid();
  if (pid && pidAlive(pid)) {
    process.kill(pid);
    console.log(`已停止 PID ${pid}`);
  } else if (await portOpen()) {
    console.log("端口仍在监听，但没有 pid 文件；请运行 stop.cmd 用端口方式结束");
    process.exitCode = 1;
    return;
  } else {
    console.log("服务未在运行");
  }
  try { if (existsSync(pidPath)) unlinkSync(pidPath); } catch {}
};

const status = async () => {
  const open = await portOpen();
  const pid = readPid();
  console.log(open ? `运行中: http://127.0.0.1:${port}/${pid ? ` (PID ${pid})` : ""}` : "未运行");
};

switch (action) {
  case "start": await start(); break;
  case "stop": await stop(); break;
  case "status": await status(); break;
  default:
    console.log("用法: node daemon.mjs start|stop|status [port]");
    process.exitCode = 2;
}
