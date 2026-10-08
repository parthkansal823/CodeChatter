"use client";

import "@xterm/xterm/css/xterm.css";

import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal, type ITheme } from "@xterm/xterm";
import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";

import { cssVar } from "@/lib/css-color";
import { cn } from "@/lib/utils";

/** xterm colours from the design tokens (globals.css), re-read when the theme changes. */
function terminalTheme(): ITheme {
  return {
    background: cssVar("--background"),
    foreground: cssVar("--foreground"),
    cursor: cssVar("--brand"),
    cursorAccent: cssVar("--background"),
    selectionBackground: cssVar("--selection"),
    black: cssVar("--term-black"),
    red: cssVar("--term-red"),
    green: cssVar("--term-green"),
    yellow: cssVar("--term-yellow"),
    blue: cssVar("--term-blue"),
    magenta: cssVar("--term-magenta"),
    cyan: cssVar("--term-cyan"),
    white: cssVar("--term-white"),
    brightBlack: cssVar("--term-bright-black"),
    brightRed: cssVar("--term-red"),
    brightGreen: cssVar("--term-green"),
    brightYellow: cssVar("--term-yellow"),
    brightBlue: cssVar("--term-blue"),
    brightMagenta: cssVar("--term-magenta"),
    brightCyan: cssVar("--term-cyan"),
    brightWhite: cssVar("--foreground"),
  };
}

type Props = {
  /** Called once with the terminal; may return a cleanup. */
  onReady: (terminal: Terminal) => void | (() => void);
  onData?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  className?: string;
  label: string;
};

/** An xterm.js terminal that fills its box, follows the theme and refits on resize. */
export function XtermView({ onReady, onData, onResize, className, label }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const handlers = useRef({ onData, onResize, onReady });
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    handlers.current = { onData, onResize, onReady };
  });

  useEffect(() => {
    const element = host.current!;
    const font = getComputedStyle(document.documentElement).getPropertyValue("--font-neon").trim();
    const term = new Terminal({
      fontFamily: `${font}, ui-monospace, monospace`,
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      cursorStyle: "bar",
      scrollback: 5000,
      theme: terminalTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(element);
    term.textarea?.setAttribute("aria-label", label);
    const refit = () => {
      // Hidden (display: none) panels have no size; fit when they're shown.
      if (element.clientWidth > 0 && element.clientHeight > 0) fit.fit();
    };
    refit();
    const data = term.onData((d) => handlers.current.onData?.(d));
    const resize = term.onResize(({ cols, rows }) => handlers.current.onResize?.(cols, rows));
    const observer = new ResizeObserver(refit);
    observer.observe(element);
    terminal.current = term;
    const cleanup = handlers.current.onReady(term);
    return () => {
      cleanup?.();
      observer.disconnect();
      data.dispose();
      resize.dispose();
      term.dispose();
      terminal.current = null;
    };
    // The terminal is created once per mount; handlers are read through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (terminal.current) terminal.current.options.theme = terminalTheme();
  }, [resolvedTheme]);

  return <div ref={host} className={cn("h-full w-full overflow-hidden px-2 pt-1", className)} />;
}
