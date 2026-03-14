import Editor from "@monaco-editor/react";
import { useState } from "react";

export default function CodeEditor() {

  const [code, setCode] = useState(`// Welcome to CodeChatter

#include <iostream>
using namespace std;

int main() {
    cout << "Hello CodeChatter!";
}
`);

  return (
    <div className="flex-1">

      <Editor
        height="100%"
        theme="vs-dark"
        language="cpp"
        value={code}
        onChange={(value) => setCode(value)}
      />

    </div>
  );
}