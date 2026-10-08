"use client";

import { useEffect, useRef } from "react";

export default function EditorSpike() {
  const a = useRef<HTMLDivElement>(null);
  const b = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => {
    // The VS Code services may be initialised only once per page.
    if (started.current || !a.current || !b.current) return;
    started.current = true;
    import("./run").then(({ runSafely }) => runSafely(a.current!, b.current!));
  }, []);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", height: "100vh" }}>
      <div ref={a} style={{ height: "100vh" }} />
      <div ref={b} style={{ height: "100vh" }} />
    </div>
  );
}
