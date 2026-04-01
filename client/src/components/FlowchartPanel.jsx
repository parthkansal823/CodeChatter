import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ChevronLeft,
  Code2,
  Download,
  FileCode2,
  GitBranch,
  Loader2,
  RefreshCw,
} from "lucide-react";
import mermaid from "mermaid";

import { useAuth } from "../hooks/useAuth";
import { API_ENDPOINTS } from "../config/security";
import { secureFetch } from "../utils/security";

mermaid.initialize({
  startOnLoad: false,
  theme: "base",
  themeVariables: {
    primaryColor: "#60a5fa",
    primaryTextColor: "#ffffff",
    primaryBorderColor: "#2563eb",
    lineColor: "#94a3b8",
    secondaryColor: "#a78bfa",
    tertiaryColor: "#f1f5f9",
  },
  flowchart: { curve: "basis", padding: 20 },
  fontFamily: "Inter, ui-sans-serif, sans-serif",
});

let _mermaidCounter = 0;

async function renderMermaid(code) {
  const id = `fc-${++_mermaidCounter}`;
  const { svg } = await mermaid.render(id, code);
  return svg;
}

function extractMermaid(raw = "") {
  const fenced = raw.match(/```(?:mermaid)?\s*\n?([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  return raw
    .replace(/^```(?:mermaid)?\s*/im, "")
    .replace(/\s*```\s*$/im, "")
    .trim();
}

// Replace any reserved-word classDef/class names Gemini may still produce
const RESERVED_REMAP = {
  process: "cProc",
  loop:    "cLoop",
  error:   "cErr",
  end:     "cStart",
  default: "cProc",
  class:   "cProc",
};

function sanitizeClassNames(code = "") {
  let out = code;
  for (const [bad, safe] of Object.entries(RESERVED_REMAP)) {
    // classDef <bad> …
    out = out.replace(new RegExp(`(classDef\\s+)${bad}\\b`, "gi"), `$1${safe}`);
    // class NodeId <bad>
    out = out.replace(new RegExp(`(class\\s+[\\w,]+\\s+)${bad}\\b`, "gi"), `$1${safe}`);
  }
  return out;
}

const LANG_MAP = {
  py: "Python", js: "JavaScript", ts: "TypeScript",
  jsx: "React JSX", tsx: "React TSX", java: "Java",
  cs: "C#", cpp: "C++", c: "C", go: "Go",
  rs: "Rust", rb: "Ruby", php: "PHP", kt: "Kotlin",
  swift: "Swift", sh: "Shell",
};

function detectLanguage(filePath) {
  const ext = filePath?.split(".").pop()?.toLowerCase() || "";
  return LANG_MAP[ext] || null;
}

// Class names must NOT be Mermaid reserved words (process, loop, error, end, default, class…)
const CLASS = {
  startEnd: "cStart",
  process:  "cProc",
  decision: "cDec",
  func:     "cFunc",
  loop:     "cLoop",
  io:       "cIO",
  error:    "cErr",
};

const LEGEND = [
  { color: "#4ade80", cls: CLASS.startEnd, label: "Start / End" },
  { color: "#60a5fa", cls: CLASS.process,  label: "Process"     },
  { color: "#fbbf24", cls: CLASS.decision, label: "Decision"    },
  { color: "#a78bfa", cls: CLASS.func,     label: "Function"    },
  { color: "#fb923c", cls: CLASS.loop,     label: "Loop"        },
  { color: "#34d399", cls: CLASS.io,       label: "I / O"       },
  { color: "#f87171", cls: CLASS.error,    label: "Error"       },
];

export default function FlowchartPanel({ onBack, roomId, activeFilePath, activeCode }) {
  const { token } = useAuth();
  const [mermaidCode, setMermaidCode] = useState("");
  const [svgHtml, setSvgHtml]         = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError]       = useState(null);
  const [renderError, setRenderError] = useState(null);
  const [detectedLang, setDetectedLang] = useState(null);
  const [showSource, setShowSource]   = useState(false);
  const lastGeneratedCodeRef          = useRef(null);

  const generate = useCallback(async (code, filePath) => {
    if (!code?.trim()) {
      setGenError("Open a file to generate a flowchart.");
      return;
    }
    setIsGenerating(true);
    setGenError(null);
    setRenderError(null);
    setSvgHtml("");
    setMermaidCode("");
    setShowSource(false);

    const language = detectLanguage(filePath) || "code";
    setDetectedLang(language);

    try {
      const prompt =
        `Generate a colorful Mermaid flowchart for the ${language} code below.\n\n` +
        `OUTPUT RULES:\n` +
        `- Return ONLY raw Mermaid code — no markdown fences, no explanation\n` +
        `- First line must be exactly: flowchart TD\n` +
        `- Node IDs: short alphanumeric only (e.g. A, B, N1, CheckX)\n\n` +
        `COPY THESE classDef LINES EXACTLY into your output (these names are intentionally prefixed with "c" to avoid reserved words):\n` +
        `classDef cStart fill:#4ade80,stroke:#16a34a,color:#fff,stroke-width:2px\n` +
        `classDef cProc  fill:#60a5fa,stroke:#2563eb,color:#fff,stroke-width:2px\n` +
        `classDef cDec   fill:#fbbf24,stroke:#d97706,color:#000,stroke-width:2px\n` +
        `classDef cFunc  fill:#a78bfa,stroke:#7c3aed,color:#fff,stroke-width:2px\n` +
        `classDef cLoop  fill:#fb923c,stroke:#ea580c,color:#fff,stroke-width:2px\n` +
        `classDef cIO    fill:#34d399,stroke:#059669,color:#fff,stroke-width:2px\n` +
        `classDef cErr   fill:#f87171,stroke:#dc2626,color:#fff,stroke-width:2px\n\n` +
        `APPLY classes to every node using:  class NodeId className\n` +
        `  ([Label])  → class NodeId cStart\n` +
        `  [Label]    → class NodeId cProc\n` +
        `  {Label}    → class NodeId cDec\n` +
        `  [[Label]]  → class NodeId cFunc\n` +
        `  [/Label/]  → class NodeId cLoop  or  cIO\n\n` +
        `EXAMPLE (follow this exact format):\n` +
        `flowchart TD\n` +
        `    classDef cStart fill:#4ade80,stroke:#16a34a,color:#fff,stroke-width:2px\n` +
        `    classDef cProc fill:#60a5fa,stroke:#2563eb,color:#fff,stroke-width:2px\n` +
        `    classDef cDec fill:#fbbf24,stroke:#d97706,color:#000,stroke-width:2px\n` +
        `    S([Start]) --> R[/Read input/]\n` +
        `    R --> C{Valid?}\n` +
        `    C -->|Yes| P[Do work]\n` +
        `    C -->|No| E([End])\n` +
        `    P --> E\n` +
        `    class S,E cStart\n` +
        `    class R cIO\n` +
        `    class C cDec\n` +
        `    class P cProc\n\n` +
        `Now generate the flowchart for this ${language} code:\n` +
        `${code.slice(0, 4000)}`;

      const response = await secureFetch(
        API_ENDPOINTS.AI_ASSIST,
        { method: "POST", body: JSON.stringify({ prompt, roomId }) },
        token,
      );

      const raw     = response?.answer || response?.result || response?.text || "";
      const cleaned = sanitizeClassNames(extractMermaid(raw));
      if (!cleaned) throw new Error("AI returned an empty response — try regenerating.");
      setMermaidCode(cleaned);
    } catch (e) {
      setGenError(e.message || "Failed to generate flowchart.");
    } finally {
      setIsGenerating(false);
    }
  }, [roomId, token]);

  // Auto-generate when active file changes
  useEffect(() => {
    if (activeCode && activeCode !== lastGeneratedCodeRef.current) {
      lastGeneratedCodeRef.current = activeCode;
      generate(activeCode, activeFilePath);
    }
  }, [activeCode, activeFilePath, generate]);

  // Render SVG whenever mermaidCode updates
  useEffect(() => {
    if (!mermaidCode) return;
    setRenderError(null);
    renderMermaid(mermaidCode)
      .then((svg) => setSvgHtml(svg))
      .catch((err) => {
        const msg = err?.message || String(err) || "Diagram syntax error.";
        setRenderError(`Render failed: ${msg.slice(0, 200)}`);
      });
  }, [mermaidCode]);

  const baseName = activeFilePath?.split("/").pop()?.replace(/\.[^.]+$/, "") || "flowchart";

  const downloadSVG = () => {
    if (!svgHtml) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([svgHtml], { type: "image/svg+xml" }));
    a.download = `${baseName}.svg`;
    a.click();
  };

  const downloadMMD = () => {
    if (!mermaidCode) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([mermaidCode], { type: "text/plain" }));
    a.download = `${baseName}.mmd`;
    a.click();
  };

  const downloadPNG = () => {
    if (!svgHtml) return;
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svgHtml], { type: "image/svg+xml" }));
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width  = img.naturalWidth  * scale;
      canvas.height = img.naturalHeight * scale;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      const a = document.createElement("a");
      a.download = `${baseName}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
    };
    img.src = url;
  };

  const diagramReady = !isGenerating && svgHtml && !renderError;

  return (
    <div className="flex h-full flex-col bg-white dark:bg-[#09090b]">

      {/* ── Header ───────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-100 px-3 py-2.5 dark:border-white/[0.04]">
        <button
          onClick={onBack}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-white/[0.06] dark:hover:text-white"
        >
          <ChevronLeft size={15} />
        </button>
        <GitBranch size={14} className="text-cyan-500" />
        <p className="flex-1 text-sm font-semibold text-zinc-800 dark:text-zinc-100">Flowchart</p>

        {/* Source toggle */}
        {mermaidCode && (
          <button
            onClick={() => setShowSource((v) => !v)}
            title={showSource ? "Show diagram" : "View source"}
            className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
              showSource
                ? "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300"
                : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
            }`}
          >
            <Code2 size={13} />
          </button>
        )}

        {/* Regenerate */}
        <button
          onClick={() => generate(activeCode, activeFilePath)}
          disabled={isGenerating || !activeCode}
          title="Regenerate"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-40 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
        >
          <RefreshCw size={13} className={isGenerating ? "animate-spin" : ""} />
        </button>
      </div>

      {/* ── File pill ────────────────────────────────────── */}
      {activeFilePath && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-zinc-100 px-3 py-1.5 dark:border-white/[0.04]">
          <FileCode2 size={11} className="shrink-0 text-zinc-400" />
          <p className="min-w-0 flex-1 truncate text-[11px] text-zinc-400 dark:text-zinc-500">
            {activeFilePath.split("/").pop()}
          </p>
          {detectedLang && (
            <span className="shrink-0 rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] font-semibold text-cyan-600 dark:bg-cyan-500/10 dark:text-cyan-400">
              {detectedLang}
            </span>
          )}
        </div>
      )}

      {/* ── Body ─────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">

        {/* Loading */}
        {isGenerating && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3">
            <Loader2 size={22} className="animate-spin text-cyan-500" />
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Generating {detectedLang ? `${detectedLang} ` : ""}flowchart…
            </p>
          </div>
        )}

        {/* Empty state */}
        {!isGenerating && !activeCode && !genError && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
            <GitBranch size={26} className="text-zinc-300 dark:text-zinc-600" />
            <p className="text-sm font-medium text-zinc-500">No file open</p>
            <p className="text-xs text-zinc-400">Open a file in the editor to auto-generate its flowchart.</p>
          </div>
        )}

        {/* Generation error */}
        {!isGenerating && genError && (
          <div className="m-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/20 dark:bg-amber-900/10">
            <AlertCircle size={13} className="mt-0.5 shrink-0 text-amber-500" />
            <div>
              <p className="text-xs font-medium text-amber-700 dark:text-amber-300">{genError}</p>
              {activeCode && (
                <button
                  onClick={() => generate(activeCode, activeFilePath)}
                  className="mt-1.5 text-[11px] font-semibold text-amber-600 underline underline-offset-2 hover:text-amber-800 dark:text-amber-400"
                >
                  Try again
                </button>
              )}
            </div>
          </div>
        )}

        {/* Render error */}
        {!isGenerating && renderError && (
          <div className="m-3 space-y-2">
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-500/20 dark:bg-red-900/10">
              <AlertCircle size={13} className="mt-0.5 shrink-0 text-red-500" />
              <div>
                <p className="text-xs font-medium text-red-700 dark:text-red-300">{renderError}</p>
                <button
                  onClick={() => generate(activeCode, activeFilePath)}
                  className="mt-1.5 text-[11px] font-semibold text-red-600 underline underline-offset-2 hover:text-red-800 dark:text-red-400"
                >
                  Regenerate
                </button>
              </div>
            </div>
            {/* Show source automatically on render error so user can see what went wrong */}
            {mermaidCode && (
              <pre className="overflow-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 font-mono text-[10px] leading-relaxed text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-400">
                {mermaidCode}
              </pre>
            )}
          </div>
        )}

        {/* Source view */}
        {!isGenerating && showSource && mermaidCode && !renderError && (
          <div className="flex-1 overflow-auto p-3">
            <pre className="h-full overflow-auto rounded-xl border border-zinc-200 bg-zinc-50 p-3 font-mono text-[11px] leading-relaxed text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300">
              {mermaidCode}
            </pre>
          </div>
        )}

        {/* Diagram */}
        {!isGenerating && !showSource && svgHtml && !renderError && (
          <div className="flex-1 overflow-auto p-3">
            <div
              className="rounded-xl border border-zinc-100 bg-white p-4 dark:border-white/[0.04] dark:bg-white/[0.03]"
              dangerouslySetInnerHTML={{ __html: svgHtml }}
            />
            {/* Legend */}
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
              {LEGEND.map(({ color, label }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: color }} />
                  <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Download bar ─────────────────────────────────── */}
      {diagramReady && (
        <div className="shrink-0 border-t border-zinc-100 p-3 dark:border-white/[0.04]">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Download</p>
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { label: "SVG",  onClick: downloadSVG },
              { label: "PNG",  onClick: downloadPNG },
              { label: ".mmd", onClick: downloadMMD },
            ].map(({ label, onClick }) => (
              <button
                key={label}
                onClick={onClick}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs font-medium text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-400 dark:hover:border-zinc-600"
              >
                <Download size={11} />
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
