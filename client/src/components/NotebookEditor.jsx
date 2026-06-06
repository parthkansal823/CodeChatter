/**
 * NotebookEditor — Jupyter-style notebook for `.nb` files.
 *
 * File content is stored as JSON:
 * { version: 1, language: "python", cells: [{ id, type, source, outputs, executionCount }] }
 *
 * Cell types:  "code"  |  "markdown"
 * Output types: "stdout" | "stderr" | "error" | "result"
 */
import {
  useCallback, useEffect, useRef, useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChevronDown, ChevronUp, Code2,
  Loader2, Play, PlayCircle,
  Plus, RotateCcw, Trash2, Type,
} from "lucide-react";
import toast from "react-hot-toast";

import { API_ENDPOINTS } from "../config/security";
import { secureFetch } from "../utils/security";
import { useAuth } from "../hooks/useAuth";

// ── constants ────────────────────────────────────────────────────────────────

const SUPPORTED_LANGUAGES = [
  "python", "javascript", "typescript", "go", "rust",
  "java", "cpp", "c", "ruby", "php", "shell", "lua",
];

// eslint-disable-next-line no-control-regex
const ANSI_STRIP = /\u001b\[[0-9;]*m/g;

// ── helpers ───────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function makeCell(type = "code") {
  return { id: uid(), type, source: "", outputs: [], executionCount: null };
}

function parseNotebook(content) {
  if (!content?.trim()) {
    return { version: 1, language: "python", cells: [makeCell("code")] };
  }
  try {
    const nb = JSON.parse(content);
    if (nb?.cells && Array.isArray(nb.cells)) return nb;
  } catch { /* fall through */ }
  // If the file isn't valid JSON, treat whole content as a single code cell
  return { version: 1, language: "python", cells: [{ ...makeCell("code"), source: content }] };
}

function serializeNotebook(nb) {
  return JSON.stringify(nb, null, 2);
}

function stripAnsi(text) {
  return (text || "").replace(ANSI_STRIP, "");
}

// ── sub-components ────────────────────────────────────────────────────────────

function OutputBlock({ outputs }) {
  if (!outputs?.length) return null;
  return (
    <div className="border-t border-zinc-100 dark:border-white/[0.05]">
      {outputs.map((out, i) => {
        if (out.type === "error") {
          return (
            <pre key={i} className="overflow-x-auto whitespace-pre-wrap break-words px-4 py-2 font-mono text-[11.5px] leading-relaxed text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-500/[0.06]">
              {stripAnsi(out.text)}
            </pre>
          );
        }
        if (out.type === "stderr") {
          return (
            <pre key={i} className="overflow-x-auto whitespace-pre-wrap break-words px-4 py-2 font-mono text-[11.5px] leading-relaxed text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/[0.06]">
              {stripAnsi(out.text)}
            </pre>
          );
        }
        return (
          <pre key={i} className="overflow-x-auto whitespace-pre-wrap break-words px-4 py-2 font-mono text-[11.5px] leading-relaxed text-zinc-700 dark:text-zinc-300">
            {stripAnsi(out.text)}
          </pre>
        );
      })}
    </div>
  );
}

function CellStatusBadge({ count, running }) {
  if (running) {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-500/20">
        <Loader2 size={10} className="animate-spin text-violet-500" />
      </span>
    );
  }
  return (
    <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-zinc-100 px-1 text-[10px] font-mono font-bold text-zinc-500 dark:bg-white/[0.06] dark:text-zinc-400">
      {count != null ? count : "·"}
    </span>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export default function NotebookEditor({
  code = "",
  onCodeChange,
  readOnly = false,
  roomId,
}) {
  const { token } = useAuth();

  const [notebook, setNotebook] = useState(() => parseNotebook(code));
  const [runningCells, setRunningCells] = useState(new Set());
  const [activeCellId, setActiveCellId] = useState(null);
  const [markdownEditing, setMarkdownEditing] = useState(new Set());
  const [runAll, setRunAll] = useState(false); // true while "run all" is in progress
  const notebookRef = useRef(notebook);
  const changeTimeoutRef = useRef(null);

  // Sync external code → notebook when file switches (not on every keystroke)
  const prevCodeRef = useRef(code);
  useEffect(() => {
    if (prevCodeRef.current === code) return;
    prevCodeRef.current = code;
    const parsed = parseNotebook(code);
    setNotebook(parsed);
    notebookRef.current = parsed;
  }, [code]);

  // Push notebook changes back to parent with debounce
  const commitChange = useCallback((nb) => {
    notebookRef.current = nb;
    if (changeTimeoutRef.current) clearTimeout(changeTimeoutRef.current);
    changeTimeoutRef.current = setTimeout(() => {
      const serialized = serializeNotebook(notebookRef.current);
      prevCodeRef.current = serialized;
      onCodeChange?.(serialized);
    }, 300);
  }, [onCodeChange]);

  const updateNotebook = useCallback((updater) => {
    setNotebook((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      commitChange(next);
      return next;
    });
  }, [commitChange]);

  // ── cell mutations ──────────────────────────────────────────────────────────

  const updateCell = useCallback((id, patch) => {
    updateNotebook((nb) => ({
      ...nb,
      cells: nb.cells.map((c) => c.id === id ? { ...c, ...patch } : c),
    }));
  }, [updateNotebook]);

  const addCell = useCallback((afterId = null, type = "code") => {
    const cell = makeCell(type);
    updateNotebook((nb) => {
      const idx = afterId ? nb.cells.findIndex((c) => c.id === afterId) : nb.cells.length - 1;
      const cells = [...nb.cells];
      cells.splice(idx + 1, 0, cell);
      return { ...nb, cells };
    });
    setActiveCellId(cell.id);
    if (type === "markdown") {
      setMarkdownEditing((prev) => new Set([...prev, cell.id]));
    }
    return cell.id;
  }, [updateNotebook]);

  const deleteCell = useCallback((id) => {
    updateNotebook((nb) => ({
      ...nb,
      cells: nb.cells.length > 1 ? nb.cells.filter((c) => c.id !== id) : nb.cells,
    }));
  }, [updateNotebook]);

  const moveCell = useCallback((id, direction) => {
    updateNotebook((nb) => {
      const cells = [...nb.cells];
      const idx = cells.findIndex((c) => c.id === id);
      const target = direction === "up" ? idx - 1 : idx + 1;
      if (target < 0 || target >= cells.length) return nb;
      [cells[idx], cells[target]] = [cells[target], cells[idx]];
      return { ...nb, cells };
    });
  }, [updateNotebook]);

  const clearOutputs = useCallback(() => {
    updateNotebook((nb) => ({
      ...nb,
      cells: nb.cells.map((c) => ({ ...c, outputs: [], executionCount: null })),
    }));
  }, [updateNotebook]);

  // ── execution ───────────────────────────────────────────────────────────────

  const executionCounterRef = useRef(0);

  const runCell = useCallback(async (cellId, withContext = false) => {
    const nb = notebookRef.current;
    const cell = nb.cells.find((c) => c.id === cellId);
    if (!cell || cell.type !== "code" || !cell.source.trim()) return;
    if (runningCells.has(cellId)) return;

    let code = cell.source;
    if (withContext) {
      // Prepend all code cells above this one
      const idx = nb.cells.findIndex((c) => c.id === cellId);
      const context = nb.cells
        .slice(0, idx)
        .filter((c) => c.type === "code" && c.source.trim())
        .map((c) => c.source)
        .join("\n\n");
      if (context) code = `${context}\n\n${cell.source}`;
    }

    setRunningCells((prev) => new Set([...prev, cellId]));

    // Optimistically clear outputs
    updateCell(cellId, { outputs: [], executionCount: null });

    try {
      const result = await secureFetch(
        API_ENDPOINTS.RUN_SNIPPET(roomId),
        {
          method: "POST",
          body: JSON.stringify({ code, language: nb.language || "python", stdin: "" }),
        },
        token,
      );

      executionCounterRef.current += 1;
      const count = executionCounterRef.current;
      const outputs = [];

      if (result.stdout?.trim()) {
        outputs.push({ type: "stdout", text: result.stdout });
      }
      if (result.stderr?.trim()) {
        outputs.push({ type: result.exitCode !== 0 ? "error" : "stderr", text: result.stderr });
      }
      if (outputs.length === 0 && result.exitCode === 0) {
        outputs.push({ type: "result", text: "" });
      }

      updateCell(cellId, { outputs, executionCount: count });
    } catch (e) {
      executionCounterRef.current += 1;
      updateCell(cellId, {
        outputs: [{ type: "error", text: e.message || "Execution failed" }],
        executionCount: executionCounterRef.current,
      });
    } finally {
      setRunningCells((prev) => {
        const next = new Set(prev);
        next.delete(cellId);
        return next;
      });
    }
  }, [roomId, runningCells, token, updateCell]);

  const handleRunAll = useCallback(async () => {
    if (runAll) return;
    setRunAll(true);
    clearOutputs();
    const codeCells = notebookRef.current.cells.filter((c) => c.type === "code");
    for (const cell of codeCells) {
      await runCell(cell.id, false);
    }
    setRunAll(false);
    toast.success("All cells executed");
  }, [clearOutputs, runAll, runCell]);

  // ── render helpers ──────────────────────────────────────────────────────────

  const renderCell = (cell, idx) => {
    const isActive = activeCellId === cell.id;
    const isRunning = runningCells.has(cell.id);
    const isMarkdownPreview = cell.type === "markdown" && !markdownEditing.has(cell.id);

    return (
      <div
        key={cell.id}
        onClick={() => setActiveCellId(cell.id)}
        className={`group relative rounded-xl border transition-all ${
          isActive
            ? "border-violet-400/60 shadow-sm dark:border-violet-500/40"
            : "border-zinc-200 dark:border-white/[0.07] hover:border-zinc-300 dark:hover:border-white/[0.12]"
        } bg-white dark:bg-[#0d0d10]`}
      >
        {/* Cell header */}
        <div className="flex items-center gap-1.5 border-b border-zinc-100 px-3 py-1.5 dark:border-white/[0.05]">
          {/* Cell type icon */}
          {cell.type === "code" ? (
            <Code2 size={12} className="text-violet-400 shrink-0" />
          ) : (
            <Type size={12} className="text-amber-400 shrink-0" />
          )}

          {/* Execution badge */}
          {cell.type === "code" && (
            <CellStatusBadge count={cell.executionCount} running={isRunning} />
          )}

          <span className="flex-1 text-[10px] text-zinc-400">
            {cell.type === "code" ? notebook.language : "markdown"}
          </span>

          {/* Action buttons — visible on hover / when active */}
          <div className={`flex items-center gap-0.5 transition-opacity ${isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
            {!readOnly && (
              <>
                {cell.type === "markdown" && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setMarkdownEditing((prev) => { const n = new Set(prev); n.has(cell.id) ? n.delete(cell.id) : n.add(cell.id); return n; }); }}
                    title={isMarkdownPreview ? "Edit" : "Preview"}
                    className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-white/[0.08] dark:hover:text-zinc-200"
                  >
                    {isMarkdownPreview ? <Code2 size={11} /> : <Type size={11} />}
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); moveCell(cell.id, "up"); }}
                  disabled={idx === 0}
                  title="Move up"
                  className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-white/[0.08] dark:hover:text-zinc-200 disabled:opacity-30"
                >
                  <ChevronUp size={11} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); moveCell(cell.id, "down"); }}
                  disabled={idx === notebook.cells.length - 1}
                  title="Move down"
                  className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-white/[0.08] dark:hover:text-zinc-200 disabled:opacity-30"
                >
                  <ChevronDown size={11} />
                </button>
                {cell.type === "code" && (
                  <button
                    onClick={(e) => { e.stopPropagation(); updateCell(cell.id, { outputs: [], executionCount: null }); }}
                    title="Clear output"
                    className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-white/[0.08] dark:hover:text-zinc-200"
                  >
                    <RotateCcw size={11} />
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); deleteCell(cell.id); }}
                  title="Delete cell"
                  className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
                >
                  <Trash2 size={11} />
                </button>
              </>
            )}
            {cell.type === "code" && (
              <button
                onClick={(e) => { e.stopPropagation(); runCell(cell.id, false); }}
                disabled={isRunning || readOnly}
                title="Run cell (Shift+Enter)"
                className="flex h-6 w-6 items-center justify-center rounded bg-violet-100 text-violet-600 hover:bg-violet-200 dark:bg-violet-500/20 dark:text-violet-400 dark:hover:bg-violet-500/30 disabled:opacity-50"
              >
                {isRunning ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
              </button>
            )}
          </div>
        </div>

        {/* Cell body */}
        {cell.type === "code" ? (
          <div
            className="relative"
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.shiftKey) {
                e.preventDefault();
                runCell(cell.id, false);
              }
            }}
          >
            <textarea
              readOnly={readOnly}
              value={cell.source}
              onChange={(e) => updateCell(cell.id, { source: e.target.value })}
              spellCheck={false}
              placeholder="# Write code here…"
              rows={Math.max(3, cell.source.split("\n").length + 1)}
              className="w-full resize-none bg-transparent px-4 py-3 font-mono text-[13px] leading-relaxed text-zinc-800 outline-none placeholder-zinc-300 dark:text-zinc-200 dark:placeholder-zinc-600"
              style={{ minHeight: "3.5rem", maxHeight: "60vh", overflowY: "auto" }}
            />
          </div>
        ) : isMarkdownPreview ? (
          <div
            className="prose prose-sm prose-zinc dark:prose-invert max-w-none cursor-text px-4 py-3 text-sm"
            onDoubleClick={() => { if (!readOnly) setMarkdownEditing((prev) => new Set([...prev, cell.id])); }}
            title="Double-click to edit"
          >
            {cell.source
              ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{cell.source}</ReactMarkdown>
              : <p className="text-zinc-400 dark:text-zinc-600 italic text-xs">Double-click to add markdown…</p>
            }
          </div>
        ) : (
          <textarea
            readOnly={readOnly}
            autoFocus
            value={cell.source}
            onChange={(e) => updateCell(cell.id, { source: e.target.value })}
            onBlur={() => setMarkdownEditing((prev) => { const n = new Set(prev); n.delete(cell.id); return n; })}
            spellCheck={false}
            placeholder="Write markdown here… (click outside to preview)"
            rows={Math.max(4, cell.source.split("\n").length + 1)}
            className="w-full resize-none bg-transparent px-4 py-3 font-mono text-[13px] leading-relaxed text-zinc-800 outline-none placeholder-zinc-300 dark:text-zinc-200 dark:placeholder-zinc-600"
            style={{ minHeight: "4rem", maxHeight: "60vh", overflowY: "auto" }}
          />
        )}

        {/* Outputs */}
        {cell.type === "code" && <OutputBlock outputs={cell.outputs} />}

        {/* Add cell buttons — appear below active cell */}
        {!readOnly && isActive && (
          <div className="absolute -bottom-4 left-0 right-0 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
            <button
              onClick={(e) => { e.stopPropagation(); addCell(cell.id, "code"); }}
              className="flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 py-0.5 text-[10px] font-semibold text-zinc-500 shadow-sm hover:border-violet-300 hover:text-violet-600 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-violet-500 dark:hover:text-violet-400"
            >
              <Plus size={9} /> Code
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); addCell(cell.id, "markdown"); }}
              className="flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 py-0.5 text-[10px] font-semibold text-zinc-500 shadow-sm hover:border-amber-300 hover:text-amber-600 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-amber-500 dark:hover:text-amber-400"
            >
              <Plus size={9} /> Markdown
            </button>
          </div>
        )}
      </div>
    );
  };

  // ── full render ───────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col bg-zinc-50 dark:bg-[#0b0b0c]">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-zinc-200 bg-white px-4 py-2 dark:border-white/[0.06] dark:bg-[#0d0d10]">
        <span className="mr-1 text-[11px] font-bold uppercase tracking-widest text-zinc-400">Notebook</span>

        {/* Language selector */}
        <select
          value={notebook.language}
          disabled={readOnly}
          onChange={(e) => updateNotebook((nb) => ({ ...nb, language: e.target.value }))}
          className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] text-zinc-600 outline-none focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
        >
          {SUPPORTED_LANGUAGES.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-1.5">
          {!readOnly && (
            <>
              <button
                onClick={() => addCell(null, "code")}
                title="Add code cell"
                className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-600 hover:border-violet-300 hover:text-violet-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-violet-500 dark:hover:text-violet-400"
              >
                <Plus size={11} /> Code
              </button>
              <button
                onClick={() => addCell(null, "markdown")}
                title="Add markdown cell"
                className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-600 hover:border-amber-300 hover:text-amber-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-amber-500 dark:hover:text-amber-400"
              >
                <Plus size={11} /> Markdown
              </button>
              <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
              <button
                onClick={clearOutputs}
                title="Clear all outputs"
                className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-500 dark:hover:border-zinc-500 dark:hover:text-zinc-300"
              >
                <RotateCcw size={11} /> Clear
              </button>
            </>
          )}
          <button
            onClick={handleRunAll}
            disabled={runAll || readOnly}
            title="Run all cells"
            className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {runAll ? <Loader2 size={11} className="animate-spin" /> : <PlayCircle size={11} />}
            Run All
          </button>
        </div>
      </div>

      {/* Cells */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
        {notebook.cells.map((cell, idx) => renderCell(cell, idx))}

        {/* Add first cell if empty */}
        {!readOnly && notebook.cells.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm text-zinc-400">No cells yet</p>
            <div className="flex gap-2">
              <button
                onClick={() => addCell(null, "code")}
                className="flex items-center gap-2 rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:border-violet-300 hover:text-violet-600 dark:border-zinc-700 dark:text-zinc-400"
              >
                <Plus size={14} /> Code cell
              </button>
              <button
                onClick={() => addCell(null, "markdown")}
                className="flex items-center gap-2 rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:border-amber-300 hover:text-amber-600 dark:border-zinc-700 dark:text-zinc-400"
              >
                <Plus size={14} /> Markdown cell
              </button>
            </div>
          </div>
        )}

        {/* Bottom padding so the last cell's "add" buttons are visible */}
        <div className="h-16" />
      </div>
    </div>
  );
}
