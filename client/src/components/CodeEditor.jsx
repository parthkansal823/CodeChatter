import Editor from "@monaco-editor/react";
import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const LANGUAGE_TEMPLATES = {
  cpp: `#include <iostream>
using namespace std;

int main() {
    cout << "Hello CodeChatter!" << endl;
    return 0;
}`,
  c: `#include <stdio.h>

int main() {
    printf("Hello CodeChatter!");
    return 0;
}`,
  javascript: `// Welcome to CodeChatter

console.log("Hello CodeChatter!");

function greet(name){
  return \`Hello \${name}!\`;
}`,
  typescript: `function greet(name: string): string {
  return "Hello " + name;
}

console.log(greet("CodeChatter"));`,
  python: `def greet(name):
    return f"Hello {name}"

print("Hello CodeChatter!")`,
  java: `public class Main {
    public static void main(String[] args) {
        System.out.println("Hello CodeChatter!");
    }
}`,
  go: `package main

import "fmt"

func main() {
    fmt.Println("Hello CodeChatter!")
}`,
  rust: `fn main() {
    println!("Hello CodeChatter!");
}`,
  php: `<?php
echo "Hello CodeChatter!";
?>`,
  ruby: `puts "Hello CodeChatter!"`,
  html: `<!DOCTYPE html>
<html>
<head>
  <title>CodeChatter</title>
</head>
<body>
  <h1>Hello CodeChatter!</h1>
</body>
</html>`,
  css: `body {
  background: #0f0f0f;
  color: white;
}`,
  json: `{
  "message": "Hello CodeChatter"
}`,
  markdown: `# CodeChatter

Welcome to the **CodeChatter editor**

## Features
- Live coding
- Multi-language support
- Markdown preview

\`\`\`javascript
console.log("Hello CodeChatter");
\`\`\`
`
};

const LANGUAGE_EXTENSION_MAP = {
  cpp: "cpp",
  c: "c",
  javascript: "javascript",
  typescript: "typescript",
  python: "python",
  java: "java",
  go: "go",
  rust: "rust",
  php: "php",
  ruby: "ruby",
  html: "html",
  css: "css",
  json: "json",
  markdown: "markdown"
};

export default function CodeEditor({
  selectedLanguage = "cpp",
  theme = "vs-dark",
  onCodeChange
}) {

  const editorRef = useRef(null);

  const [codeMap, setCodeMap] = useState({});
  const [code, setCode] = useState("");
  const [isEditorReady, setIsEditorReady] = useState(false);

  const isMarkdown = selectedLanguage === "markdown";

  // Load saved code
  useEffect(() => {
    const saved = localStorage.getItem("codechatter_editor");
    if (saved) {
      setCodeMap(JSON.parse(saved));
    }
  }, []);

  // Load code when language changes
  useEffect(() => {
    const savedCode =
      codeMap[selectedLanguage] ||
      LANGUAGE_TEMPLATES[selectedLanguage] ||
      "";

    setCode(savedCode);
  }, [selectedLanguage, codeMap]);

  // Save code per language
  const handleEditorChange = (value) => {

    if (value === undefined) return;

    setCode(value);

    const updated = {
      ...codeMap,
      [selectedLanguage]: value
    };

    setCodeMap(updated);

    localStorage.setItem(
      "codechatter_editor",
      JSON.stringify(updated)
    );

    onCodeChange?.(value);
  };

  const handleEditorMount = (editor) => {
    editorRef.current = editor;
    setIsEditorReady(true);
    editor.focus();
  };

  return (
    <div className="flex-1 flex relative overflow-hidden bg-white dark:bg-zinc-950">

      {/* Editor Section */}
      <div className={isMarkdown ? "w-[60%] h-full" : "w-full h-full"}>

        <Editor
          height="100%"
          theme={theme}
          language={LANGUAGE_EXTENSION_MAP[selectedLanguage] || "cpp"}
          value={code}
          onChange={handleEditorChange}
          onMount={handleEditorMount}
          options={{
            minimap: { enabled: false },
            fontSize: 15,
            fontFamily: "'Fira Code', monospace",
            lineNumbers: "on",
            smoothScrolling: true,
            cursorBlinking: "smooth",
            wordWrap: "on",
            automaticLayout: true,
            scrollBeyondLastLine: false,
            formatOnPaste: true,
            formatOnType: true,
            bracketPairColorization: { enabled: true },
            guides: { bracketPairs: true },
            stickyScroll: { enabled: true },
            padding: { top: 10 }
          }}
        />

      </div>

      {/* Markdown Preview */}
      {isMarkdown && (
        <div
          className={`w-[40%] h-full border-l overflow-auto p-6 max-w-none ${
            theme === "vs-dark"
              ? "prose prose-invert border-zinc-800"
              : "prose border-zinc-300 bg-white text-black"
          }`}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {code}
          </ReactMarkdown>
        </div>
      )}

      {!isEditorReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-zinc-950 text-zinc-500 dark:text-zinc-400">
          Loading Editor...
        </div>
      )}

    </div>
  );
}