import Editor from "@monaco-editor/react";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AnimatePresence } from "framer-motion";
import { ChevronRight, Clock, Download, FolderTree } from "lucide-react";

import "../utils/monaco";
import { detectLanguageFromName } from "../utils/workspace";
import { getFileVisual } from "../utils/fileIcons";
import { usePreferences } from "../hooks/usePreferences";
import FileVersionHistory, { saveFileVersion } from "./FileVersionHistory";

function Breadcrumb({ filePath, fileName }) {
  if (!filePath) return null;

  const parts = filePath.split("/").filter(Boolean);
  const { Icon, className: iconClassName } = getFileVisual(fileName);

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-edge-subtle bg-panel px-3 py-1.5 text-[11px] text-fg-muted">
      <FolderTree size={13} className="flex-shrink-0" />
      {parts.slice(0, -1).map((part, idx) => (
        <div key={idx} className="flex items-center gap-1">
          <ChevronRight size={12} className="flex-shrink-0" />
          <span className="inline-block max-w-[100px] truncate">{part}</span>
        </div>
      ))}
      <div className="flex flex-shrink-0 items-center gap-1">
        <ChevronRight size={12} />
        <Icon size={14} className={iconClassName} />
        <span className="font-medium text-fg">{fileName}</span>
      </div>
    </div>
  );
}

export default function CodeEditor({
  selectedFileName,
  selectedFilePath,
  code = "",
  theme = "vs-dark",
  readOnly = false,
  onCodeChange,
  onCursorChange,
  remoteCursors = [],
  roomId,
}) {
  const { preferences } = usePreferences();
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const remoteDecorationIdsRef = useRef([]);
  const remoteCursorStyleRef = useRef(null);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 });
  const [showVersionHistory, setShowVersionHistory] = useState(false);

  const selectedLanguage = detectLanguageFromName(selectedFileName || "");
  const isMarkdown = selectedLanguage === "markdown";
  const deferredCode = useDeferredValue(code);
  const lineCount = code ? code.split("\n").length : 1;
  const characterCount = code.length;
  const editorPath = selectedFilePath
    ? encodeURI(`file:///${selectedFilePath.replace(/^\/+/, "")}`)
    : "file:///untitled";

  const handleEditorMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    setIsEditorReady(true);
    editor.focus();

    editor.onDidChangeCursorPosition((event) => {
      const nextCursor = {
        line: event.position.lineNumber,
        column: event.position.column,
      };

      setCursorPosition(nextCursor);
      onCursorChange?.(nextCursor);
    });

    try {
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF,
        () => { editor.getAction("editor.action.formatDocument")?.run(); }
      );
      // Ctrl+S → save version snapshot
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
        () => {
          const val = editor.getValue();
          saveFileVersion(roomId, selectedFilePath, val);
        }
      );
    } catch {
      // Ignore if monaco is not fully available yet
    }
  };

  useEffect(() => {
    if (!editorRef.current || typeof window === "undefined") return undefined;
    editorRef.current.focus();
    const nextPosition = editorRef.current.getPosition() || { lineNumber: 1, column: 1 };
    const nextCursor = {
      line: nextPosition.lineNumber,
      column: nextPosition.column,
    };

    const frameId = window.requestAnimationFrame(() => {
      setCursorPosition(nextCursor);
      onCursorChange?.(nextCursor);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [editorPath, onCursorChange]);

  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) {
      return undefined;
    }

    if (typeof document === "undefined") {
      return undefined;
    }

    if (!remoteCursorStyleRef.current) {
      const styleElement = document.createElement("style");
      styleElement.setAttribute("data-codechatter-remote-cursors", "true");
      document.head.appendChild(styleElement);
      remoteCursorStyleRef.current = styleElement;
    }

    const model = editorRef.current.getModel();

    if (!model) {
      return undefined;
    }

    const sanitizedRemoteCursors = remoteCursors
      .filter((cursor) => Number.isFinite(cursor?.line) && Number.isFinite(cursor?.column))
      .map((cursor) => ({
        ...cursor,
        classKey: String(cursor.sessionId || cursor.userId || cursor.username || "remote")
          .replace(/[^a-zA-Z0-9_-]/g, ""),
      }));

    remoteCursorStyleRef.current.textContent = sanitizedRemoteCursors.map((cursor) => `
        .monaco-editor .remote-cursor-${cursor.classKey} {
          border-left: 2px solid ${cursor.color};
          margin-left: -1px;
          height: 1.35em;
        }
        .monaco-editor .remote-cursor-label-${cursor.classKey} {
          background: ${cursor.color};
          color: #ffffff;
          border-radius: 999px;
          font-size: 0.7rem;
          font-weight: 700;
          margin-left: 0.35rem;
          padding: 0.1rem 0.4rem;
        }
      `).join("\n");

    remoteDecorationIdsRef.current = editorRef.current.deltaDecorations(
      remoteDecorationIdsRef.current,
      sanitizedRemoteCursors.map((cursor) => ({
        range: new monacoRef.current.Range(
          cursor.line,
          cursor.column,
          cursor.line,
          cursor.column
        ),
        options: {
          beforeContentClassName: `remote-cursor-${cursor.classKey}`,
          after: {
            content: ` ${cursor.username}`,
            inlineClassName: `remote-cursor-label-${cursor.classKey}`,
          },
          stickiness: monacoRef.current.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          zIndex: 20,
        },
      }))
    );

    return () => {
      if (editorRef.current) {
        remoteDecorationIdsRef.current = editorRef.current.deltaDecorations(
          remoteDecorationIdsRef.current,
          []
        );
      }
    };
  }, [remoteCursors]);

  useEffect(() => {
    return () => {
      if (remoteCursorStyleRef.current?.parentNode) {
        remoteCursorStyleRef.current.parentNode.removeChild(remoteCursorStyleRef.current);
      }
    };
  }, []);

  return (
    <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-hovered">
      <Breadcrumb filePath={selectedFilePath} fileName={selectedFileName} />

      <div className={`flex min-h-0 flex-1 ${isMarkdown ?"flex-col xl:flex-row" : ""}`}>
        <div className={isMarkdown ? "min-h-[55%] xl:min-h-0 xl:w-[58%]" : "w-full"}>
          <Editor
            height="100%"
            defaultPath={editorPath}
            path={editorPath}
            theme={theme}
            defaultLanguage={selectedLanguage}
            language={selectedLanguage}
            defaultValue={code}
            value={code}
            onChange={(value) => onCodeChange?.(value ?? "")}
            onMount={handleEditorMount}
            saveViewState
            keepCurrentModel
            options={{
              minimap: { enabled: preferences.minimap },
              fontSize: preferences.fontSize,
              fontFamily: preferences.fontLigatures ? "'Fira Code', 'JetBrains Mono', monospace" : "monospace",
              fontLigatures: preferences.fontLigatures,
              lineNumbers: "on",
              lineHeight: preferences.lineHeight * 20,
              smoothScrolling: true,
              readOnly,
              domReadOnly: readOnly,
              cursorBlinking: "smooth",
              cursorSmoothCaretAnimation: "on",
              wordWrap: preferences.wordWrap ? "on" : "off",
              automaticLayout: true,
              scrollBeyondLastLine: false,
              formatOnPaste: true,
              formatOnType: true,
              quickSuggestions: {
                other: true,
                comments: true,
                strings: true,
              },
              quickSuggestionsDelay: 80,
              suggestOnTriggerCharacters: true,
              inlineSuggest: { enabled: !readOnly },
              suggest: {
                preview: true,
                previewMode: "subwordSmart",
                showStatusBar: true,
                showSnippets: true,
                showWords: true,
                snippetsPreventQuickSuggestions: false,
                selectionMode: "whenQuickSuggestion",
              },
              acceptSuggestionOnCommitCharacter: true,
              acceptSuggestionOnEnter: "on",
              snippetSuggestions: "top",
              tabCompletion: "on",
              wordBasedSuggestions: "currentDocument",
              wordBasedSuggestionsOnlySameLanguage: true,
              parameterHints: { enabled: true },
              suggestSelection: "first",
              renderLineHighlight: "all",
              bracketPairColorization: { enabled: true },
              guides: { bracketPairs: true, indentation: true },
              stickyScroll: { enabled: true },
              padding: { top: 14, bottom: 14 },
              scrollbar: {
                alwaysConsumeMouseWheel: false,
                verticalScrollbarSize: 10,
                horizontalScrollbarSize: 10,
              },
              scrollBeyondLastColumn: 5,
              columnSelection: false,
            }}
          />
        </div>

        {isMarkdown && (
          <div className="min-h-[45%] border-t border-edge-subtle bg-panel xl:min-h-0 xl:w-[42%] xl:border-l xl:border-t-0">
            <div className={`h-full overflow-auto p-6 ${
 theme ==="vs-dark"
                ? "prose prose-invert"
                : "prose text-black"
            }`}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{deferredCode}</ReactMarkdown>
            </div>
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-2 border-t border-edge-subtle bg-panel px-2 py-1 text-[10px] text-fg-muted sm:gap-3 sm:px-3 sm:text-[11px]">
        <span className="font-semibold uppercase tracking-wider text-fg-muted">
          {readOnly ? <span className="text-warning-400">View only</span>
            : isMarkdown ? "Markdown"
            : selectedLanguage}
        </span>
        <span className="hidden text-fg-subtle sm:inline">·</span>
        <span>Ln {cursorPosition.line}, Col {cursorPosition.column}</span>
        <span className="ml-auto hidden text-fg-subtle md:inline">{lineCount} lines · {characterCount} chars</span>
        {selectedFileName && (
          <button
            onClick={() => {
              const blob = new Blob([code], { type: "text/plain" });
              const url  = URL.createObjectURL(blob);
              const a    = document.createElement("a");
              a.href = url; a.download = selectedFileName; a.click();
              URL.revokeObjectURL(url);
            }}
            title="Download file"
            className="flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-selected hover:text-fg"
          >
            <Download size={11} />
            <span className="hidden sm:inline">Download</span>
          </button>
        )}
        {!readOnly && (
          <button
            onClick={() => setShowVersionHistory(v => !v)}
            title="Version history (Ctrl+S to save)"
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors ${
 showVersionHistory
 ?"bg-brand-100 text-brand-600"
                : "hover:bg-selected hover:text-fg"
            }`}
          >
            <Clock size={11} />
            <span className="hidden sm:inline">History</span>
          </button>
        )}
      </div>

      {/* Version history slide-out */}
      <AnimatePresence>
        {showVersionHistory && (
          <div className="absolute bottom-9 right-0 top-0 z-20 overflow-hidden shadow-2xl">
            <FileVersionHistory
              roomId={roomId}
              filePath={selectedFilePath}
              fileName={selectedFileName}
              onRestore={(content) => {
                onCodeChange?.(content);
                setShowVersionHistory(false);
              }}
              onClose={() => setShowVersionHistory(false)}
            />
          </div>
        )}
      </AnimatePresence>

      {!isEditorReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-hovered/90 text-fg-muted">
          Loading editor...
        </div>
      )}
    </div>
  );
}
