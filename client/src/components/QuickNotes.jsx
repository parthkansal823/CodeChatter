import { useCallback, useEffect, useRef, useState } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft, Bold, Check, Code, Eye, FileText, Hash,
  Italic, List, Minus, Pin, PinOff, Plus, Search,
  StickyNote, Trash2, Type,
} from "lucide-react";

// ── storage ──────────────────────────────────────────────────────────────────

const STORAGE_PREFIX = "cc-notes-v2-";

const NOTE_COLORS = [
  { id: "zinc",   bg: "bg-hovered",   border: "border-l-fg-subtle",   dot: "bg-fg-subtle"   },
  { id: "violet", bg: "bg-brand-50", border: "border-l-brand-400", dot: "bg-brand-400" },
  { id: "amber",  bg: "bg-warning-50",  border: "border-l-warning-400",  dot: "bg-warning-400"  },
  { id: "emerald",bg: "bg-success-50",border: "border-l-success-400",dot: "bg-success-400"},
  { id: "rose",   bg: "bg-danger-50",    border: "border-l-danger-400",   dot: "bg-danger-400"   },
  { id: "sky",    bg: "bg-info-50",      border: "border-l-info-400",    dot: "bg-info-400"    },
];

function colorOf(id) {
  return NOTE_COLORS.find((c) => c.id === id) || NOTE_COLORS[0];
}

function newNote() {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: "",
    content: "",
    color: "zinc",
    pinned: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function loadNotes(roomId) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + (roomId || "global"));
    if (raw) return JSON.parse(raw);
  } catch { /* */ }
  return [{ ...newNote(), title: "Scratch pad", color: "violet" }];
}

function saveNotes(roomId, notes) {
  try {
    localStorage.setItem(STORAGE_PREFIX + (roomId || "global"), JSON.stringify(notes));
  } catch { /* */ }
}

function relativeTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

// ── format helpers ────────────────────────────────────────────────────────────

function wrapSelection(ta, before, after = before) {
  if (!ta) return "";
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const selected = value.slice(s, e);
  const next = value.slice(0, s) + before + selected + after + value.slice(e);
  setTimeout(() => {
    ta.focus();
    ta.setSelectionRange(s + before.length, e + before.length);
  }, 0);
  return next;
}

function prependLines(ta, prefix) {
  if (!ta) return "";
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const before = value.slice(0, s);
  const _selected = value.slice(s, e) || "";
  const lineStart = before.lastIndexOf("\n") + 1;
  const nextLines = value
    .slice(lineStart, e || value.length)
    .split("\n")
    .map((l) => (l.startsWith(prefix) ? l : prefix + l))
    .join("\n");
  const next = value.slice(0, lineStart) + nextLines + value.slice(e || value.length);
  setTimeout(() => ta.focus(), 0);
  return next;
}

// ── FormatToolbar ──────────────────────────────────────────────────────────────

function FormatToolbar({ taRef, onChange }) {
  const fmt = (fn) => {
    const next = fn(taRef.current);
    if (next !== undefined) onChange(next);
  };

  return (
    <div className="flex items-center gap-0.5 border-b border-edge-subtle px-2 py-1.5">
      {[
        { icon: Bold,  title: "Bold",        action: (ta) => wrapSelection(ta, "**") },
        { icon: Italic,title: "Italic",      action: (ta) => wrapSelection(ta, "_") },
        { icon: Code,  title: "Inline code", action: (ta) => wrapSelection(ta, "`") },
        { icon: Hash,  title: "Heading",     action: (ta) => prependLines(ta, "## ") },
        { icon: List,  title: "Bullet",      action: (ta) => prependLines(ta, "- ") },
        { icon: Check, title: "Todo",        action: (ta) => prependLines(ta, "- [ ] ") },
        { icon: Minus, title: "Divider",     action: (ta) => { const v = ta?.value || ""; return v + "\n\n---\n\n"; } },
      ].map(({ icon: Icon, title, action }) => (
        <button
          key={title}
          title={title}
          onMouseDown={(e) => { e.preventDefault(); fmt(action); }}
          className="flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-hovered hover:text-fg"
        >
          <Icon size={12} />
        </button>
      ))}
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export default function QuickNotes({ roomId, onBack = null }) {
  const [notes, setNotes] = useState(() => loadNotes(roomId));
  const [openId, setOpenId] = useState(null);
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState(false);
  const [saved, setSaved] = useState(false);
  const saveTimer = useRef(null);
  const taRef = useRef(null);

  const openNote = notes.find((n) => n.id === openId) || null;

  // Persist on change
  useEffect(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveNotes(roomId, notes);
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
    }, 500);
    return () => clearTimeout(saveTimer.current);
  }, [notes, roomId]);

  const updateNote = useCallback((id, patch) => {
    setNotes((prev) =>
      prev.map((n) => n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n),
    );
  }, []);

  const createNote = () => {
    const n = newNote();
    setNotes((prev) => [...prev, n]);
    setOpenId(n.id);
    setPreview(false);
  };

  const deleteNote = (id) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    if (openId === id) setOpenId(null);
  };

  const togglePin = (id) => {
    setNotes((prev) =>
      prev.map((n) => n.id === id ? { ...n, pinned: !n.pinned } : n),
    );
  };

  const sortedNotes = [...notes]
    .filter((n) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });

  // ── Edit view ─────────────────────────────────────────────────────────────

  if (openNote) {
    const _color = colorOf(openNote.color);

    return (
      <div className="flex h-full flex-col bg-panel">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-edge-subtle px-3 py-2.5">
          <button
            onClick={() => setOpenId(null)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-muted hover:bg-hovered hover:text-fg"
          >
            <ArrowLeft size={14} />
          </button>

          <input
            value={openNote.title}
            onChange={(e) => updateNote(openNote.id, { title: e.target.value })}
            placeholder="Note title…"
            className="flex-1 bg-transparent text-sm font-semibold text-fg outline-none placeholder:text-fg-subtle"
          />

          <Motion.span
            animate={{ opacity: saved ? 1 : 0 }}
            className="text-[10px] text-success-500"
          >
            <Check size={11} className="inline" /> saved
          </Motion.span>

          <button
            onClick={() => setPreview((v) => !v)}
            title={preview ? "Edit" : "Preview"}
            className={`flex h-7 w-7 items-center justify-center rounded-lg transition ${
 preview
 ?"bg-brand-100 text-brand-600"
                : "text-fg-muted hover:bg-hovered"
            }`}
          >
            {preview ? <Type size={13} /> : <Eye size={13} />}
          </button>

          <button
            onClick={() => deleteNote(openNote.id)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-muted hover:bg-danger-50 hover:text-danger-500"
          >
            <Trash2 size={13} />
          </button>
        </div>

        {/* Color picker */}
        <div className="flex items-center gap-1.5 border-b border-edge-subtle px-3 py-1.5">
          {NOTE_COLORS.map((c) => (
            <button
              key={c.id}
              onClick={() => updateNote(openNote.id, { color: c.id })}
              className={`h-4 w-4 rounded-full transition-transform ${c.dot} ${openNote.color === c.id ?"ring-2 ring-offset-1 ring-edge-subtle scale-110" : "opacity-60 hover:opacity-100 hover:scale-110"}`}
            />
          ))}
        </div>

        {/* Format toolbar (only in edit mode) */}
        {!preview && (
          <FormatToolbar
            taRef={taRef}
            onChange={(next) => updateNote(openNote.id, { content: next })}
          />
        )}

        {/* Content */}
        <div className="relative flex-1 overflow-y-auto">
          {preview ? (
            <div className="prose prose-sm prose-zinc dark:prose-invert max-w-none px-4 py-3 text-sm">
              {openNote.content
                ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{openNote.content}</ReactMarkdown>
                : <p className="italic text-fg-subtle">Nothing here yet…</p>
              }
            </div>
          ) : (
            <textarea
              ref={taRef}
              value={openNote.content}
              onChange={(e) => updateNote(openNote.id, { content: e.target.value })}
              placeholder={`Start writing…\n\nSupports **markdown** — toggle preview to render.\n\n- [ ] todo items\n- [x] checked todos`}
              className="h-full min-h-full w-full resize-none bg-transparent px-4 py-3 font-mono text-xs leading-6 text-fg outline-none placeholder:text-fg-subtle"
              spellCheck={false}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-edge-subtle px-3 py-1.5">
          <span className="text-[10px] text-fg-subtle">Updated {relativeTime(openNote.updatedAt)}</span>
          <span className="text-[10px] text-fg-subtle">{openNote.content.length.toLocaleString()} chars</span>
        </div>
      </div>
    );
  }

  // ── List view ─────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col bg-panel">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-edge-subtle px-3 py-2.5">
        <div className="flex items-center gap-2">
          {onBack ? (
            <button
              onClick={onBack}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-muted hover:bg-hovered hover:text-fg"
              title="Back to tools"
            >
              <ArrowLeft size={14} />
            </button>
          ) : null}
          <StickyNote size={14} className="text-warning-400" />
          <span className="text-sm font-semibold text-fg">Notes</span>
          <span className="rounded-full bg-hovered px-1.5 py-0.5 text-[10px] font-semibold text-fg-muted">
            {notes.length}
          </span>
        </div>
        <button
          onClick={createNote}
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-warning-400 text-white hover:bg-warning-500 transition"
          title="New note"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Search */}
      <div className="border-b border-edge-subtle px-3 py-2">
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search notes…"
            className="w-full rounded-md border border-edge-subtle bg-panel py-1.5 pl-7 pr-2 text-xs outline-none focus:border-warning-400"
          />
        </div>
      </div>

      {/* Note list */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5">
        <AnimatePresence initial={false}>
          {sortedNotes.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <FileText size={28} className="text-fg" />
              <p className="text-xs text-fg-subtle">{search ? "No notes match your search" : "No notes yet"}</p>
              {!search && (
                <button
                  onClick={createNote}
                  className="flex items-center gap-1.5 rounded-lg bg-warning-400 px-3 py-1.5 text-xs font-semibold text-white hover:bg-warning-500"
                >
                  <Plus size={12} /> New note
                </button>
              )}
            </div>
          ) : (
            sortedNotes.map((note) => {
              const color = colorOf(note.color);
              const preview = note.content.slice(0, 80).replace(/[#*`_>]/g, "").trim();

              return (
                <Motion.div
                  key={note.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.15 }}
                  onClick={() => { setOpenId(note.id); setPreview(false); }}
                  className={`group relative cursor-pointer rounded-xl border-l-4 p-3 transition hover:shadow-sm ${color.bg} ${color.border}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="flex-1 truncate text-xs font-semibold text-fg">
                      {note.title || <span className="font-normal italic text-fg-subtle">Untitled</span>}
                    </p>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); togglePin(note.id); }}
                        title={note.pinned ? "Unpin" : "Pin"}
                        className={`flex h-5 w-5 items-center justify-center rounded ${note.pinned ?"text-warning-500" : "text-fg-subtle hover:text-fg"}`}
                      >
                        {note.pinned ? <Pin size={10} /> : <PinOff size={10} />}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteNote(note.id); }}
                        className="flex h-5 w-5 items-center justify-center rounded text-fg-subtle hover:text-danger-500"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </div>
                  {preview && (
                    <p className="mt-1 line-clamp-2 text-[11px] text-fg-muted">{preview}</p>
                  )}
                  <div className="mt-1.5 flex items-center gap-2">
                    {note.pinned && <Pin size={9} className="text-warning-400" />}
                    <span className="text-[10px] text-fg-subtle">{relativeTime(note.updatedAt)}</span>
                    <span className="text-[10px] text-fg">·</span>
                    <span className="text-[10px] text-fg-subtle">{note.content.length} chars</span>
                  </div>
                </Motion.div>
              );
            })
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
