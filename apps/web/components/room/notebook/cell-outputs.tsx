"use client";

import type { NotebookOutput } from "@codechatter/workspace-model";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cssVar } from "@/lib/css-color";
import { cn } from "@/lib/utils";

import { parseAnsi, stripAnsi } from "./ansi";

const remarkPlugins = [remarkGfm];

/** What a code cell printed and returned, in the order the kernel sent it. */
export function CellOutputs({ outputs }: { outputs: NotebookOutput[] }) {
  if (!outputs.length) return null;
  return (
    <div className="flex flex-col gap-1 py-1.5 pr-3 pl-1 text-xs" role="group" aria-label="Output">
      {outputs.map((output, i) => (
        <Output key={i} output={output} />
      ))}
    </div>
  );
}

function Output({ output }: { output: NotebookOutput }) {
  switch (output.output_type) {
    case "stream":
      return (
        <Ansi
          text={output.text}
          className={cn(output.name === "stderr" && "rounded-sm bg-destructive/5 px-1.5 py-0.5")}
        />
      );
    case "error":
      return (
        <div role="alert" className="rounded-sm bg-destructive/5 px-1.5 py-1">
          {output.traceback.length ? (
            <Ansi text={output.traceback.join("\n")} />
          ) : (
            <pre className="font-mono whitespace-pre-wrap">
              <span className="font-semibold text-destructive">{output.ename}</span>: {output.evalue}
            </pre>
          )}
        </div>
      );
    default:
      return <Rich data={output.data} />;
  }
}

/** The richest form the browser can show safely: an image, HTML, Markdown, then plain text. */
function Rich({ data }: { data: Record<string, unknown> }) {
  const png = data["image/png"];
  const jpeg = data["image/jpeg"];
  const svg = data["image/svg+xml"];
  const html = data["text/html"];
  const markdown = data["text/markdown"];
  const text = data["text/plain"];
  const alt = typeof text === "string" ? text : "Plot";
  if (typeof png === "string" || typeof jpeg === "string") {
    const src = typeof png === "string" ? `data:image/png;base64,${png}` : `data:image/jpeg;base64,${jpeg as string}`;
    // eslint-disable-next-line @next/next/no-img-element -- a kernel's plot, inline as data
    return <img src={src} alt={alt} className="max-w-full self-start rounded-sm bg-white" />;
  }
  if (typeof svg === "string") {
    // An SVG as an image runs no scripts and loads nothing.
    // eslint-disable-next-line @next/next/no-img-element -- a kernel's plot, inline as data
    return <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt={alt} className="max-w-full self-start rounded-sm bg-white" />;
  }
  if (typeof html === "string") return <HtmlOutput html={html} />;
  if (typeof markdown === "string") {
    return (
      <div className="text-sm [&_a]:underline [&_code]:font-mono [&_li]:ml-5 [&_ol]:list-decimal [&_p]:my-1 [&_ul]:list-disc">
        <Markdown remarkPlugins={remarkPlugins}>{markdown}</Markdown>
      </div>
    );
  }
  if (typeof text === "string") return <Ansi text={text} />;
  return <pre className="font-mono text-muted-foreground">{`[${Object.keys(data).join(", ") || "empty"} output]`}</pre>;
}

/**
 * HTML from a kernel (a pandas table, say) in an iframe that runs no scripts and can't
 * submit or navigate; same-origin only so this page can read its height. Styled from
 * the theme's tokens.
 */
function HtmlOutput({ html }: { html: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(40);
  const { resolvedTheme } = useTheme();
  const [style, setStyle] = useState("");

  useEffect(() => {
    const fg = cssVar("--foreground");
    const muted = cssVar("--muted-foreground");
    const border = cssVar("--border");
    const stripe = cssVar("--muted");
    const font = getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the colours are read from the live theme
    setStyle(
      `html,body{margin:0;background:transparent;color:${fg};font:12px/1.5 ${font || "sans-serif"};}` +
        `table{border-collapse:collapse;font-variant-numeric:tabular-nums}th,td{border:1px solid ${border};padding:2px 8px;text-align:right}` +
        `thead th{font-weight:600}tbody tr:nth-child(odd){background:${stripe}}a{color:${fg}}.dataframe caption,small{color:${muted}}`,
    );
  }, [resolvedTheme]);

  const measure = () => {
    const body = frame.current?.contentDocument?.documentElement;
    if (body) setHeight(Math.min(Math.max(body.scrollHeight, 20), 600));
  };

  return (
    <iframe
      ref={frame}
      title="HTML output"
      sandbox="allow-same-origin"
      srcDoc={`<!doctype html><meta charset="utf-8"><style>${style}</style>${html}`}
      onLoad={measure}
      className="w-full rounded-sm"
      style={{ height }}
    />
  );
}

/** Text with its ANSI colours in the terminal's tokens. */
function Ansi({ text, className }: { text: string; className?: string }) {
  const runs = parseAnsi(text);
  return (
    <pre className={cn("font-mono leading-relaxed break-words whitespace-pre-wrap", className)}>
      {runs.length === 1 && !runs[0]!.color && !runs[0]!.bold && !runs[0]!.dim
        ? stripAnsi(text)
        : runs.map((run, i) => (
            <span
              key={i}
              className={cn(run.bold && "font-semibold", run.dim && "opacity-70")}
              style={run.color ? { color: `var(--term-${run.color})` } : undefined}
            >
              {run.text}
            </span>
          ))}
    </pre>
  );
}
