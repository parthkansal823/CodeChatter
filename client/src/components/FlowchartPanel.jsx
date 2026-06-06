import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ChevronLeft,
  Code2,
  Download,
  FileCode2,
  GitBranch,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import mermaid from "mermaid";

import { useAuth } from "../hooks/useAuth";
import { API_ENDPOINTS } from "../config/security";
import { secureFetch } from "../utils/security";
import { logActivity } from "./ActivityLog";

mermaid.initialize({
  startOnLoad: false,
  theme: "base",
  themeVariables: {
    primaryColor: "#4f46e5",
    primaryTextColor: "#ffffff",
    primaryBorderColor: "#4338ca",
    lineColor: "#94a3b8",
    secondaryColor: "#22c55e",
    tertiaryColor: "#0f172a",
    clusterBkg: "#111827",
    clusterBorder: "#334155",
  },
  flowchart: { curve: "basis", padding: 20, useMaxWidth: true },
  fontFamily: "Inter, ui-sans-serif, sans-serif",
});

let mermaidCounter = 0;

async function renderMermaid(code) {
  const id = `fc-${++mermaidCounter}`;
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

const RESERVED_REMAP = {
  process: "cProc",
  loop: "cLoop",
  error: "cErr",
  end: "cStart",
  default: "cProc",
  class: "cProc",
};

function sanitizeClassNames(code = "") {
  let output = code;
  for (const [bad, safe] of Object.entries(RESERVED_REMAP)) {
    output = output.replace(new RegExp(`(classDef\\s+)${bad}\\b`, "gi"), `$1${safe}`);
    output = output.replace(new RegExp(`(class\\s+[\\w,]+\\s+)${bad}\\b`, "gi"), `$1${safe}`);
  }
  return output;
}

const LANG_MAP = {
  py: "Python",
  js: "JavaScript",
  ts: "TypeScript",
  jsx: "React JSX",
  tsx: "React TSX",
  java: "Java",
  cs: "C#",
  cpp: "C++",
  c: "C",
  go: "Go",
  rs: "Rust",
  rb: "Ruby",
  php: "PHP",
  kt: "Kotlin",
  swift: "Swift",
  sh: "Shell",
};

function detectLanguage(filePath) {
  const ext = filePath?.split(".").pop()?.toLowerCase() || "";
  return LANG_MAP[ext] || null;
}

const LEGEND = [
  { color: "#4ade80", label: "Start / End" },
  { color: "#60a5fa", label: "Process" },
  { color: "#fbbf24", label: "Decision" },
  { color: "#a78bfa", label: "Function" },
  { color: "#fb923c", label: "Loop" },
  { color: "#34d399", label: "Input / Output" },
  { color: "#f87171", label: "Error" },
];

function formatTime(timestamp) {
  if (!timestamp) return null;
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function FlowchartPanel({ onBack, roomId, activeFilePath, activeCode }) {
  const { token } = useAuth();
  const [mermaidCode, setMermaidCode] = useState("");
  const [svgHtml, setSvgHtml] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState(null);
  const [renderError, setRenderError] = useState(null);
  const [showSource, setShowSource] = useState(false);
  const [generatedSignature, setGeneratedSignature] = useState(null);
  const [generatedAt, setGeneratedAt] = useState(null);
  const lastRenderedSignatureRef = useRef(null);

  const detectedLang = useMemo(() => detectLanguage(activeFilePath) || "Code", [activeFilePath]);
  const fileName = useMemo(() => activeFilePath?.split("/").pop() || null, [activeFilePath]);
  const fileSignature = useMemo(() => {
    if (!activeFilePath && !activeCode) return null;
    return `${activeFilePath || "untitled"}::${activeCode || ""}`;
  }, [activeCode, activeFilePath]);
  const baseName = useMemo(
    () => activeFilePath?.split("/").pop()?.replace(/\.[^.]+$/, "") || "flowchart",
    [activeFilePath],
  );
  const needsGeneration = Boolean(activeCode?.trim()) && generatedSignature !== fileSignature;
  const diagramReady = !isGenerating && svgHtml && !renderError && generatedSignature === fileSignature;

  useEffect(() => {
    if (!activeCode?.trim()) {
      setMermaidCode("");
      setSvgHtml("");
      setShowSource(false);
      setGenError(null);
      setRenderError(null);
      setGeneratedSignature(null);
      setGeneratedAt(null);
      lastRenderedSignatureRef.current = null;
      return;
    }

    if (generatedSignature && generatedSignature !== fileSignature) {
      setMermaidCode("");
      setSvgHtml("");
      setShowSource(false);
      setGenError(null);
      setRenderError(null);
    }
  }, [activeCode, fileSignature, generatedSignature]);

  const generate = useCallback(async () => {
    if (!activeCode?.trim()) {
      setGenError("Open a file with code before generating a flowchart.");
      return;
    }

    setIsGenerating(true);
    setGenError(null);
    setRenderError(null);
    setSvgHtml("");
    setMermaidCode("");
    setShowSource(false);

    try {
      const language = detectLanguage(activeFilePath) || "code";
      const prompt =
        `Generate a polished Mermaid flowchart for this ${language} file.\n\n` +
        `Rules:\n` +
        `- Return only raw Mermaid code\n` +
        `- No markdown fences, no explanation\n` +
        `- First line must be exactly: flowchart TD\n` +
        `- Keep the flow concise and readable\n` +
        `- Prefer meaningful labels based on actual code behavior\n` +
        `- Use short alphanumeric node ids only\n` +
        `- Show decisions, loops, I/O, function boundaries, and error paths when present\n` +
        `- Always include these classDefs exactly:\n` +
        `classDef cStart fill:#4ade80,stroke:#16a34a,color:#ffffff,stroke-width:2px\n` +
        `classDef cProc fill:#60a5fa,stroke:#2563eb,color:#ffffff,stroke-width:2px\n` +
        `classDef cDec fill:#fbbf24,stroke:#d97706,color:#111827,stroke-width:2px\n` +
        `classDef cFunc fill:#a78bfa,stroke:#7c3aed,color:#ffffff,stroke-width:2px\n` +
        `classDef cLoop fill:#fb923c,stroke:#ea580c,color:#ffffff,stroke-width:2px\n` +
        `classDef cIO fill:#34d399,stroke:#059669,color:#ffffff,stroke-width:2px\n` +
        `classDef cErr fill:#f87171,stroke:#dc2626,color:#ffffff,stroke-width:2px\n` +
        `- Apply a class to every node using Mermaid class statements\n\n` +
        `Code:\n${activeCode.slice(0, 4500)}`;

      const response = await secureFetch(
        API_ENDPOINTS.AI_ASSIST,
        { method: "POST", body: JSON.stringify({ prompt, roomId }) },
        token,
      );

      const raw = response?.answer || response?.result || response?.text || "";
      const cleaned = sanitizeClassNames(extractMermaid(raw));
      if (!cleaned) {
        throw new Error("The AI did not return a usable Mermaid diagram.");
      }

      setMermaidCode(cleaned);
      setGeneratedSignature(fileSignature);
      setGeneratedAt(Date.now());
      lastRenderedSignatureRef.current = fileSignature;
      logActivity(roomId, "diagram_create", `Generated flowchart for ${fileName || "current file"}`);
    } catch (error) {
      setGenError(error.message || "Failed to generate a flowchart.");
    } finally {
      setIsGenerating(false);
    }
  }, [activeCode, activeFilePath, fileName, fileSignature, roomId, token]);

  useEffect(() => {
    if (!mermaidCode) return;
    setRenderError(null);

    renderMermaid(mermaidCode)
      .then((svg) => setSvgHtml(svg))
      .catch((error) => {
        const message = error?.message || String(error) || "Diagram syntax error.";
        setRenderError(`Render failed: ${message.slice(0, 220)}`);
      });
  }, [mermaidCode]);

  const downloadSVG = () => {
    if (!svgHtml) return;
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(new Blob([svgHtml], { type: "image/svg+xml" }));
    anchor.download = `${baseName}.svg`;
    anchor.click();
  };

  const downloadMMD = () => {
    if (!mermaidCode) return;
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(new Blob([mermaidCode], { type: "text/plain" }));
    anchor.download = `${baseName}.mmd`;
    anchor.click();
  };

  const downloadPNG = () => {
    if (!svgHtml) return;
    const image = new Image();
    const url = URL.createObjectURL(new Blob([svgHtml], { type: "image/svg+xml" }));

    image.onload = () => {
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth * scale;
      canvas.height = image.naturalHeight * scale;
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.scale(scale, scale);
      context.drawImage(image, 0, 0);
      URL.revokeObjectURL(url);

      const anchor = document.createElement("a");
      anchor.download = `${baseName}.png`;
      anchor.href = canvas.toDataURL("image/png");
      anchor.click();
    };

    image.src = url;
  };

  return (
    <div className="flex h-full flex-col bg-white dark:bg-[#0a0a0f]">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200/80 px-3 py-3 dark:border-white/[0.06]">
        <button
          onClick={onBack}
          className="flex h-8 w-8 items-center justify-center rounded-xl text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-white/[0.08] dark:hover:text-zinc-100"
          title="Back to tools"
        >
          <ChevronLeft size={15} />
        </button>

        <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-500">
          <GitBranch size={16} />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-900 dark:text-white">Flowchart</p>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            {fileName || "Choose a file to map code flow"}
          </p>
        </div>

        {mermaidCode ? (
          <button
            onClick={() => setShowSource((value) => !value)}
            className={`flex h-8 w-8 items-center justify-center rounded-xl transition ${
              showSource
                ? "bg-cyan-500/15 text-cyan-400"
                : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-white/[0.08] dark:hover:text-zinc-100"
            }`}
            title={showSource ? "Show diagram" : "View Mermaid source"}
          >
            <Code2 size={14} />
          </button>
        ) : null}

        <button
          onClick={generate}
          disabled={isGenerating || !activeCode?.trim()}
          className="inline-flex h-9 items-center gap-2 rounded-xl bg-cyan-500 px-3 text-xs font-semibold text-white transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
          title={needsGeneration ? "Generate flowchart" : "Regenerate flowchart"}
        >
          {isGenerating ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          {needsGeneration || !generatedSignature ? "Generate" : "Refresh"}
        </button>
      </div>

      {fileName ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200/80 px-3 py-2 dark:border-white/[0.06]">
          <FileCode2 size={12} className="text-zinc-400" />
          <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-500 dark:text-zinc-400">{fileName}</span>
          <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-600 dark:text-cyan-300">
            {detectedLang}
          </span>
          {generatedAt ? (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-white/[0.05] dark:text-zinc-400">
              Generated {formatTime(generatedAt)}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {!activeCode?.trim() ? (
          <div className="flex flex-1 items-center justify-center p-5">
            <div className="w-full max-w-sm rounded-3xl border border-dashed border-zinc-300 bg-zinc-50 p-5 text-center dark:border-white/[0.1] dark:bg-white/[0.03]">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-400">
                <GitBranch size={20} />
              </div>
              <p className="mt-4 text-sm font-semibold text-zinc-900 dark:text-white">Open a file first</p>
              <p className="mt-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                Flowcharts now generate only when you ask for them, so opening this panel no longer starts automatically.
              </p>
            </div>
          </div>
        ) : isGenerating ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
            <Loader2 size={24} className="animate-spin text-cyan-500" />
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">Building flowchart</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Reading the {detectedLang} file and mapping its important steps.
            </p>
          </div>
        ) : genError ? (
          <div className="m-3 rounded-3xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/20 dark:bg-amber-500/10">
            <div className="flex items-start gap-3">
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-500" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">{genError}</p>
                <p className="mt-1 text-xs text-amber-700/80 dark:text-amber-200/70">
                  Try regenerating after saving the current file or simplifying the code region.
                </p>
                <button
                  onClick={generate}
                  className="mt-3 inline-flex items-center gap-2 rounded-xl bg-amber-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-amber-400"
                >
                  <RefreshCw size={12} />
                  Try again
                </button>
              </div>
            </div>
          </div>
        ) : renderError ? (
          <div className="m-3 space-y-3">
            <div className="rounded-3xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-500/20 dark:bg-rose-500/10">
              <div className="flex items-start gap-3">
                <AlertCircle size={16} className="mt-0.5 shrink-0 text-rose-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-rose-800 dark:text-rose-200">{renderError}</p>
                  <button
                    onClick={generate}
                    className="mt-3 inline-flex items-center gap-2 rounded-xl bg-rose-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-rose-400"
                  >
                    <RefreshCw size={12} />
                    Regenerate
                  </button>
                </div>
              </div>
            </div>
            {mermaidCode ? (
              <pre className="overflow-auto rounded-3xl border border-zinc-200 bg-zinc-50 p-4 font-mono text-[11px] leading-6 text-zinc-700 dark:border-white/[0.06] dark:bg-black/30 dark:text-zinc-300">
                {mermaidCode}
              </pre>
            ) : null}
          </div>
        ) : !mermaidCode ? (
          <div className="flex flex-1 overflow-y-auto p-4">
            <div className="w-full space-y-4">
              <div className="rounded-[28px] border border-zinc-200 bg-zinc-50 p-5 dark:border-white/[0.06] dark:bg-gradient-to-br dark:from-cyan-500/10 dark:via-white/[0.04] dark:to-violet-500/10">
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/15 text-cyan-400">
                    <Sparkles size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-lg font-semibold text-zinc-900 dark:text-white">Generate a clean code map</p>
                    <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                      This turns the current file into a readable flow diagram with loops, decisions, functions, and I/O highlighted.
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  {[
                    { label: "Source", value: fileName || "Current file" },
                    { label: "Language", value: detectedLang },
                    { label: "Mode", value: "Manual generate" },
                  ].map((item) => (
                    <div key={item.label} className="rounded-2xl border border-zinc-200 bg-white px-3 py-3 dark:border-white/[0.06] dark:bg-white/[0.04]">
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-500">{item.label}</p>
                      <p className="mt-1 truncate text-sm font-semibold text-zinc-800 dark:text-zinc-100">{item.value}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={generate}
                    className="inline-flex items-center gap-2 rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-cyan-400"
                  >
                    <GitBranch size={15} />
                    Generate flowchart
                  </button>
                  <button
                    onClick={() => setShowSource((value) => !value)}
                    disabled
                    className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 px-4 py-3 text-sm font-semibold text-zinc-400 dark:border-white/[0.06] dark:text-zinc-500"
                  >
                    <Code2 size={15} />
                    Mermaid source
                  </button>
                </div>
              </div>

              <div className="rounded-[28px] border border-zinc-200 bg-white p-5 dark:border-white/[0.06] dark:bg-white/[0.02]">
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-600">What improves here</p>
                <div className="mt-3 space-y-2 text-sm text-zinc-600 dark:text-zinc-300">
                  <p>Manual generation keeps the panel calm when you only want to inspect or compare files.</p>
                  <p>Color-coded nodes make branches, loops, and helper functions easier to follow quickly.</p>
                  <p>SVG, PNG, and Mermaid downloads stay available once a diagram is ready.</p>
                </div>
              </div>
            </div>
          </div>
        ) : showSource ? (
          <div className="flex-1 overflow-auto p-3">
            <pre className="h-full overflow-auto rounded-[28px] border border-zinc-200 bg-zinc-50 p-4 font-mono text-[11px] leading-6 text-zinc-700 dark:border-white/[0.06] dark:bg-black/30 dark:text-zinc-300">
              {mermaidCode}
            </pre>
          </div>
        ) : (
          <div className="flex-1 overflow-auto p-3">
            <div className="rounded-[28px] border border-zinc-200 bg-white p-4 dark:border-white/[0.06] dark:bg-[#101119]">
              <div
                className="overflow-auto rounded-[24px] bg-white p-3 dark:bg-[#0d1117]"
                dangerouslySetInnerHTML={{ __html: svgHtml }}
              />
            </div>

            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
              {LEGEND.map(({ color, label }) => (
                <div key={label} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {diagramReady ? (
        <div className="shrink-0 border-t border-zinc-200/80 p-3 dark:border-white/[0.06]">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-600">Download</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "SVG", onClick: downloadSVG },
              { label: "PNG", onClick: downloadPNG },
              { label: ".mmd", onClick: downloadMMD },
            ].map(({ label, onClick }) => (
              <button
                key={label}
                onClick={onClick}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-zinc-200 dark:hover:border-cyan-500/40 dark:hover:bg-cyan-500/10"
              >
                <Download size={12} />
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
