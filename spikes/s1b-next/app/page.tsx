"use client";

import dynamic from "next/dynamic";

// Monaco, Yjs and the VS Code services touch `window` at import time, so the
// editor must never be evaluated on the server.
const EditorSpike = dynamic(() => import("../editor/EditorSpike"), { ssr: false });

export default function Page() {
  return <EditorSpike />;
}
