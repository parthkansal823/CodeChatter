import { defineConfig } from "vite";

// monaco-languageclient recommends deduping `vscode` so the extension API and
// the editor API resolve to one instance.
export default defineConfig({
  resolve: { dedupe: ["vscode"] },
  worker: { format: "es" },
  build: { target: "es2022" },
});
