import type { TerminalClientMessage, TerminalServerMessage } from "@codechatter/contracts";
import WebSocket from "ws";

import { log } from "./log.js";
import { JAIL } from "./plans.js";
import type { RoomSession } from "./room-session.js";

const send = (ws: WebSocket, message: TerminalServerMessage) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(message));

/**
 * One terminal tab: a TTY exec into `tmux new -A -s <session>`. tmux keeps the
 * shell alive when the tab closes or the connection drops; opening the same
 * session again reattaches to it, scrollback and running programs included.
 */
export async function openTerminal(ws: WebSocket, session: RoomSession, options: { name: string; cols: number; rows: number }): Promise<void> {
  send(ws, { t: "status", state: "starting" });
  session.terminals += 1;
  let closed = false;
  ws.once("close", () => {
    closed = true;
  });

  let handle;
  try {
    await session.ready();
    if (closed) return;
    // Plain (not login) bash, in the first window and any opened later: a login
    // shell's /etc/profile would reset PATH and drop ~/.local/bin and friends,
    // where pip, npm -g, cargo and go install programs.
    const tmux = 'umask 002; exec tmux -u new-session -A -s "$1" bash \\; set-option -g default-command bash';
    handle = await session.sandbox.exec([JAIL, "sh", "-c", tmux, "cc-term", options.name], {
      tty: true,
      cols: options.cols,
      rows: options.rows,
    });
  } catch (error) {
    session.terminals -= 1;
    send(ws, { t: "status", state: "closed", message: error instanceof Error ? error.message : "The sandbox could not start." });
    ws.close(1011);
    return;
  }
  if (closed) {
    handle.stream.destroy();
    session.terminals -= 1;
    return;
  }

  const { stream } = handle;
  send(ws, { t: "status", state: "ready" });
  stream.on("data", (chunk: Buffer) => {
    session.touch();
    if (ws.readyState === WebSocket.OPEN) ws.send(chunk, { binary: true });
  });
  const end = () => {
    send(ws, { t: "status", state: "closed" });
    ws.close(1000);
  };
  stream.on("end", end);
  stream.on("close", end);

  ws.on("message", (data, isBinary) => {
    if (isBinary) return;
    let message: TerminalClientMessage;
    try {
      message = JSON.parse(data.toString()) as TerminalClientMessage;
    } catch {
      return;
    }
    session.touch();
    if (message.t === "in" && typeof message.d === "string") stream.write(message.d);
    else if (message.t === "resize") {
      const cols = clamp(message.cols, 10, 500);
      const rows = clamp(message.rows, 4, 200);
      handle.resize(cols, rows).catch((error: unknown) => log.warn(`terminal resize: ${String(error)}`));
    }
  });
  ws.on("close", () => {
    session.terminals -= 1;
    session.touch();
    stream.destroy(); // detaches the tmux client; the session lives on
  });
}

const clamp = (value: unknown, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(value) || min)));
