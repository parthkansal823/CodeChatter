import React, { useEffect, useRef } from "react";
import Editor from "@monaco-editor/react";
import { ACTIONS } from "../Actions";
function MonacoEditor({
  socketRef,
  roomId,
  onCodeChange,
  language = "javascript",
  theme = "vs-dark",
}) {
  const editorRef = useRef(null);
  const monacoRef = useRef(null);

  const handleEditorMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    import("monaco-editor/esm/vs/basic-languages/python/python.contribution");
    import("monaco-editor/esm/vs/basic-languages/java/java.contribution");
    import("monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution");
    import("monaco-editor/esm/vs/basic-languages/php/php.contribution");
    import("monaco-editor/esm/vs/basic-languages/go/go.contribution");
    import("monaco-editor/esm/vs/basic-languages/sql/sql.contribution");
    import("monaco-editor/esm/vs/basic-languages/html/html.contribution");

    editor.onDidChangeModelContent(() => {
      const code = editor.getValue();
      onCodeChange(code);
      socketRef.current?.emit(ACTIONS.CODE_CHANGE, { roomId, code });
    });

    editor.updateOptions({
      fontFamily: "Fira Code, monospace",
      fontSize: 15,
      fontLigatures: true,
      automaticLayout: true,
      smoothScrolling: true,
      cursorSmoothCaretAnimation: true,
      minimap: { enabled: true },
      wordWrap: "on",
      scrollBeyondLastLine: false,
      formatOnType: true,
      formatOnPaste: true,
      autoClosingBrackets: "always",
      autoClosingQuotes: "always",
      autoIndent: "advanced",
      suggestOnTriggerCharacters: true,
      quickSuggestions: true,
      renderValidationDecorations: "on",
      lineNumbersMinChars: 3,
      folding: true,
      contextmenu: true,
    });

    monaco.languages.registerCompletionItemProvider("javascript", {
      provideCompletionItems: () => ({
        suggestions: [
          {
            label: "printMessage",
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: "console.log('${1:message}');",
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: "Logs a message to console",
          },
          {
            label: "forLoop",
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: "for (let i = 0; i < ${1:count}; i++) {\n\t${2:console.log(i)};\n}",
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: "Basic for loop snippet",
          },
        ],
      }),
    });

    monaco.languages.registerHoverProvider("javascript", {
      provideHover: (model, position) => {
        const word = model.getWordAtPosition(position);
        if (word?.word === "console") {
          return {
            contents: [
              { value: "**console** — global object for logging/debugging" },
              { value: "`console.log()` prints messages to stdout" },
            ],
          };
        }
      },
    });

    const model = editor.getModel();
    monaco.editor.setModelMarkers(model, "owner", [
      {
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 10,
        message: "Welcome to the collaborative Monaco editor 🚀",
        severity: monaco.MarkerSeverity.Info,
      },
    ]);
  };

  useEffect(() => {
    if (!socketRef.current) return;

    const handleCodeChange = ({ code }) => {
      if (editorRef.current && code !== editorRef.current.getValue()) {
        const position = editorRef.current.getPosition();
        editorRef.current.setValue(code);
        if (position) editorRef.current.setPosition(position);
      }
    };

    socketRef.current.on(ACTIONS.CODE_CHANGE, handleCodeChange);
    return () => socketRef.current.off(ACTIONS.CODE_CHANGE, handleCodeChange);
  }, [socketRef.current]);

  const getLang = () => {
    switch (language) {
      case "python3":
        return "python";
      case "cpp":
        return "cpp";
      case "c":
        return "c";
      case "java":
        return "java";
      case "nodejs":
        return "javascript";
      case "php":
        return "php";
      case "go":
        return "go";
      case "sql":
        return "sql";
      default:
        return "javascript";
    }
  };

  return (
    <div style={{ height: "75vh", borderRadius: "10px", overflow: "hidden" }}>
      <Editor
        height="75vh"
        theme={theme}
        language={getLang()}
        onMount={handleEditorMount}
        options={{
          fontSize: 15,
          fontLigatures: true,
          renderWhitespace: "selection",
          formatOnType: true,
          formatOnPaste: true,
          automaticLayout: true,
          cursorBlinking: "smooth",
          minimap: { enabled: true },
          bracketPairColorization: { enabled: true },
          guides: { bracketPairs: true },
        }}
      />
    </div>
  );
}

export default MonacoEditor;
