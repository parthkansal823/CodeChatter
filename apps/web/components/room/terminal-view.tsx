"use client";

import type { TerminalClientMessage, TerminalServerMessage } from "@codechatter/contracts";
import type { Terminal } from "@xterm/xterm";
import { RotateCw } from "lucide-react";
import { useRef, useState } from "react";

import { useRoom } from "@/components/room/room-context";
import { XtermView } from "@/components/room/xterm-view";
import { Button } from "@/components/ui/button";

type Status = "connecting" | "ready" | "closed";

/**
 * One terminal tab: a tmux session in the room's sandbox, over
 * /ws/terminal (same origin, so the session cookie authenticates it). tmux
 * keeps the shell alive, so reconnecting brings back the same session.
 */
export function TerminalView({ n }: { n: number }) {
  const { room } = useRoom();
  const [status, setStatus] = useState<Status>("connecting");
  const [message, setMessage] = useState<string | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const reconnect = useRef<() => void>(() => {});

  const send = (message: TerminalClientMessage) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(message));
  };

  const onReady = (term: Terminal) => {
    let disposed = false;
    const connect = () => {
      setStatus("connecting");
      setMessage(null);
      const { protocol, host } = window.location;
      const params = new URLSearchParams({ room: room.id, n: String(n), cols: String(term.cols), rows: String(term.rows) });
      const ws = new WebSocket(`${protocol === "https:" ? "wss" : "ws"}://${host}/ws/terminal?${params}`);
      ws.binaryType = "arraybuffer";
      socket.current = ws;
      ws.onmessage = (event) => {
        if (typeof event.data !== "string") {
          term.write(new Uint8Array(event.data as ArrayBuffer));
          return;
        }
        const status = JSON.parse(event.data) as TerminalServerMessage;
        if (status.state === "ready") {
          setStatus("ready");
          // Sizes may have changed while the sandbox was starting.
          send({ t: "resize", cols: term.cols, rows: term.rows });
          term.focus();
        } else if (status.state === "closed") {
          setStatus("closed");
          if (status.message) setMessage(status.message);
        }
      };
      ws.onclose = () => {
        if (disposed) return;
        setStatus("closed");
      };
    };
    reconnect.current = connect;
    connect();
    return () => {
      disposed = true;
      socket.current?.close();
    };
  };

  return (
    <div className="relative h-full">
      <XtermView
        label={`Terminal ${n}`}
        onReady={onReady}
        onData={(d) => send({ t: "in", d })}
        onResize={(cols, rows) => send({ t: "resize", cols, rows })}
      />
      {status !== "ready" && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/70 p-6 text-center">
          {status === "connecting" ? (
            <p className="text-sm text-muted-foreground" role="status">
              Starting the sandbox…
            </p>
          ) : (
            <div className="max-w-sm">
              <p className="text-sm font-medium">Terminal disconnected</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {message ?? "Your session is still running in the sandbox. Reconnect to pick up where you left off."}
              </p>
              <Button className="mt-3" size="sm" variant="outline" onClick={() => reconnect.current()}>
                <RotateCw /> Reconnect
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
