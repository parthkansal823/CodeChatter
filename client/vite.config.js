import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

/*
 * Chunking notes
 *
 * This config previously split `react`/`react-dom` into one chunk and every
 * other `react-*` package (router, hot-toast, ...) into another. Those packages
 * import React at module scope, so the two chunks reference each other and the
 * browser could evaluate them in an order that touches a binding inside its
 * temporal dead zone — producing a blank page with
 * "ReferenceError: Cannot access 'X' before initialization".
 *
 * Rule of thumb: only hand-split libraries that are *leaves* of the dependency
 * graph — big, self-contained, and loaded on demand. Anything that React
 * packages depend on (or that depends on them) stays together in one chunk so
 * Rollup controls the initialisation order.
 */
const LEAF_VENDOR_CHUNKS = [
  // Editor: huge and lazily mounted.
  { name: 'monaco-editor', test: (id) => id.includes('node_modules/monaco-editor') },
  // Terminal.
  { name: 'xterm', test: (id) => id.includes('node_modules/@xterm') },
  // Whiteboard — only when the panel is opened.
  {
    name: 'tldraw',
    test: (id) => id.includes('node_modules/tldraw') || id.includes('node_modules/@tldraw'),
  },
  // Diagram rendering, plus its parser/layout dependencies.
  {
    name: 'mermaid',
    test: (id) =>
      id.includes('node_modules/mermaid') ||
      id.includes('node_modules/dagre') ||
      id.includes('node_modules/cytoscape') ||
      id.includes('node_modules/katex') ||
      /node_modules[/\\]d3(-[a-z-]+)?[/\\]/.test(id),
  },
]

export default defineConfig({
  plugins: [react()],

  server: {
    host: true,
    port: 5173,
    // Inotify events do not cross a Docker Desktop bind mount, so inside a
    // container the default watcher never sees host edits and HMR silently
    // stops working. Polling is slower but is the only thing that fires there.
    // Set by docker-compose.dev.yml; unset on a normal host run.
    watch: process.env.VITE_DOCKER
      ? { usePolling: true, interval: 300 }
      : undefined,
  },

  build: {
    chunkSizeWarningLimit: 1000,

    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined

          for (const chunk of LEAF_VENDOR_CHUNKS) {
            if (chunk.test(id)) return chunk.name
          }

          // React and everything that touches it share a chunk on purpose —
          // see the note above. Rollup still code-splits per route around it.
          return 'vendor'
        },
      },
    },
  },

  // Pre-bundle the heavy deps so the dev server starts fast.
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      'framer-motion',
      'lucide-react',
      'react-hot-toast',
    ],
  },
})
