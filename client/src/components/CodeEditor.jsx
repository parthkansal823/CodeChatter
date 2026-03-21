import Editor from "@monaco-editor/react";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronRight } from "lucide-react";

import "../utils/monaco";
import { detectLanguageFromName } from "../utils/workspace";
import { getFileVisual } from "../utils/fileIcons";
import { usePreferences } from "../context/PreferencesContext";

function Breadcrumb({ filePath, fileName }) {
  if (!filePath) return null;

  const parts = filePath.split("/").filter(Boolean);
  const { Icon, className: iconClassName } = getFileVisual(fileName);

  return (
    <div className="flex items-center gap-1 overflow-x-auto px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800">
      <span className="flex-shrink-0">📁</span>
      {parts.slice(0, -1).map((part, idx) => (
        <div key={idx} className="flex items-center gap-1">
          <ChevronRight size={14} className="flex-shrink-0" />
          <span className="inline-block max-w-[100px] truncate">{part}</span>
        </div>
      ))}
      <div className="flex items-center gap-1 flex-shrink-0">
        <ChevronRight size={14} />
        <Icon size={14} className={iconClassName} />
        <span className="font-medium text-zinc-700 dark:text-zinc-300">{fileName}</span>
      </div>
    </div>
  );
}

export default function CodeEditor({
  selectedFileName,
  selectedFilePath,
  code = "",
  theme = "vs-dark",
  onCodeChange,
}) {
  const { preferences } = usePreferences();
  const editorRef = useRef(null);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 });

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
    setIsEditorReady(true);
    editor.focus();

    editor.onDidChangeCursorPosition((event) => {
      setCursorPosition({
        line: event.position.lineNumber,
        column: event.position.column,
      });
    });

    try {
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF,
        () => {
          editor.getAction("editor.action.formatDocument")?.run();
        }
      );
    } catch (err) {
      // Ignore if monaco is not fully typed/available yet
    }
  };

  useEffect(() => {
    if (!editorRef.current) return;
    editorRef.current.focus();
    setCursorPosition({ line: 1, column: 1 });
  }, [editorPath]);

  return (
    <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-white dark:bg-zinc-950">
      <Breadcrumb filePath={selectedFilePath} fileName={selectedFileName} />

      <div className={`flex min-h-0 flex-1 ${isMarkdown ? "flex-col xl:flex-row" : ""}`}>
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
              cursorBlinking: "smooth",
              cursorSmoothCaretAnimation: "on",
              wordWrap: preferences.wordWrap ? "on" : "off",
              automaticLayout: true,
              scrollBeyondLastLine: false,
              formatOnPaste: true,
              formatOnType: true,
              renderLineHighlight: "all",
              bracketPairColorization: { enabled: true },
              guides: { bracketPairs: true, indentation: true },
              stickyScroll: { enabled: true },
              padding: { top: 16, bottom: 16 },
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
          <div className="min-h-[45%] border-t border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 xl:min-h-0 xl:w-[42%] xl:border-l xl:border-t-0">
            <div className={`h-full overflow-auto p-6 ${
              theme === "vs-dark"
                ? "prose prose-invert"
                : "prose text-black"
            }`}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{deferredCode}</ReactMarkdown>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-zinc-200 bg-white px-4 py-2 text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
        <div className="flex items-center gap-4">
          {isMarkdown && (
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-green-500"></span>
              Preview
            </span>
          )}
          {!isMarkdown && (
            <span className="uppercase tracking-wider font-semibold text-zinc-700 dark:text-zinc-300">{selectedLanguage}</span>
          )}
        </div>

        <div className="flex items-center gap-6">
          <span className="text-zinc-500 dark:text-zinc-400">
            Ln {cursorPosition.line}, Col {cursorPosition.column}
          </span>
          <span className="text-zinc-500 dark:text-zinc-400">{lineCount} lines</span>
          <span className="text-zinc-500 dark:text-zinc-400">{characterCount} chars</span>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-900">
            <span>UTF-8</span>
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-900">
            <span>LF</span>
          </span>
        </div>
      </div>

      {!isEditorReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/90 text-zinc-500 dark:bg-zinc-950/90 dark:text-zinc-400">
          Loading editor...
        </div>
      )}
    </div>
  );
}
