import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { getWebSocketBaseUrl } from "../config/security";
import { useAuth } from "../hooks/useAuth";
import { RotateCcw } from "lucide-react";

export default function XTerminal({ roomId }) {
  const terminalRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);
  const wsRef = useRef(null);
  const { token } = useAuth();
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [reconnectKey, setReconnectKey] = useState(0);

  const reconnect = useCallback(() => {
    // Close any lingering socket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsDisconnected(false);
    // Bump the key to trigger a fresh terminal mount
    setReconnectKey(k => k + 1);
  }, []);

  useEffect(() => {
    if (!terminalRef.current || !roomId) return;

    // Initialize xterm.js
    const xterm = new Terminal({
      cursorBlink: true,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 13,
      theme: {
        background: '#09090b',
        foreground: '#d4d4d8',
        cursor: '#a78bfa',
        selectionBackground: '#7c3aed33',
      },
      convertEol: true,
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.loadAddon(new WebLinksAddon());

    xterm.open(terminalRef.current);
    fitAddon.fit();
    xterm.writeln("\x1b[36mConnecting to workspace terminal...\x1b[0m");

    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;

    let ws = null;
    let isCleanup = false;

    const connectWebSocket = async () => {
      // Small delay to prevent React StrictMode double-invoke
      await new Promise(r => setTimeout(r, 80));
      if (isCleanup) return;
      try {
        if (!token) {
          xterm.writeln("\x1b[31mx Authentication failed\x1b[0m");
          setIsDisconnected(true);
          return;
        }

        const wsUrl = `${getWebSocketBaseUrl()}/api/rooms/${roomId}/terminal?token=${encodeURIComponent(token)}`;

        ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          xterm.clear();
          xterm.writeln("\x1b[32m\u2714 Connected to workspace terminal\x1b[0m");
          xterm.writeln("");
          setIsDisconnected(false);
          const dims = { cols: xterm.cols, rows: xterm.rows };
          ws.send(JSON.stringify({ type: "resize", ...dims }));
        };

        ws.onmessage = (event) => {
          xterm.write(event.data);
        };

        ws.onclose = () => {
          if (!isCleanup) {
            xterm.writeln("\r\n\x1b[33m\u25C9 Terminal disconnected\x1b[0m");
            setIsDisconnected(true);
          }
        };

        ws.onerror = () => {
          xterm.writeln("\r\n\x1b[31mx Terminal connection error\x1b[0m");
          console.error("Terminal WebSocket error");
        };

        xterm.onData((data) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "input", data }));
          }
        });

      } catch (err) {
        console.error("Failed to connect terminal:", err);
        xterm.writeln("\x1b[31mFailed to connect to terminal server.\x1b[0m");
        setIsDisconnected(true);
      }
    };

    connectWebSocket();

    const handleResize = () => {
      if (fitAddonRef.current && xtermRef.current) {
        fitAddonRef.current.fit();
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: "resize",
            cols: xtermRef.current.cols,
            rows: xtermRef.current.rows
          }));
        }
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      isCleanup = true;
      window.removeEventListener("resize", handleResize);
      if (wsRef.current) {
        wsRef.current.close();
      }
      xterm.dispose();
    };
  }, [roomId, token, reconnectKey]);

  return (
    <div className="relative h-full w-full bg-[#09090b] p-2 overflow-hidden">
      <div ref={terminalRef} className="h-full w-full" />
      {isDisconnected && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/60 backdrop-blur-sm">
          <button
            onClick={reconnect}
            className="flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-600/30 transition-all hover:bg-brand-500 active:scale-95"
          >
            <RotateCcw size={15} />
            Reconnect Terminal
          </button>
        </div>
      )}
    </div>
  );
}
