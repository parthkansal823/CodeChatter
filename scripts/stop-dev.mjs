// Stops CodeChatter dev servers that are still running in the background,
// for example after a terminal was closed without Ctrl+C. The next
// `pnpm dev` would otherwise fail with "EADDRINUSE: address already in use".
//
// Only processes started from this repository are touched (matched by path
// and by the dev commands turbo runs); anything else on ports 3000/4000/4100
// is left alone.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, "");
const DEV = /turbo(\.exe)?"? run dev|next(\.js)?"? dev|next dev --port|nest(\.js)?"? start --watch|tsx.*(cli\.mjs|preflight|loader).*|tsx(\.js|\.mjs)?"? watch|--watch --preserveWatchOutput|dist[\\/]main\.js/;

function list() {
  if (process.platform === "win32") {
    const script =
      "Get-CimInstance Win32_Process | Where-Object CommandLine | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }";
    return execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8", maxBuffer: 64 << 20 });
  }
  return execFileSync("ps", ["-eo", "pid=,args="], { encoding: "utf8", maxBuffer: 64 << 20 }).replace(/^\s*(\d+)\s+/gm, "$1\t");
}

const targets = list()
  .split(/\r?\n/)
  .map((line) => line.split("\t"))
  .filter(([pid, cmd]) => pid && cmd && Number(pid) !== process.pid && cmd.includes(repo) && DEV.test(cmd))
  .map(([pid]) => Number(pid));

for (const pid of targets) {
  try {
    if (process.platform === "win32") execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(pid, "SIGTERM");
  } catch {
    // already gone (a parent's /T took it down)
  }
}
console.log(targets.length ? `Stopped ${targets.length} dev process(es). Run \`pnpm dev\` again.` : "No CodeChatter dev servers were running.");
