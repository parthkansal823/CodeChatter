import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  build: {
    // Raise warning threshold so chunking warnings are more meaningful
    chunkSizeWarningLimit: 1000,

    rollupOptions: {
      output: {
        manualChunks(id) {
          // Monaco Editor — very large, isolate completely
          if (id.includes('node_modules/monaco-editor')) {
            return 'monaco-editor';
          }
          // @monaco-editor/react wrapper
          if (id.includes('node_modules/@monaco-editor')) {
            return 'monaco-react';
          }
          // XTerm (terminal)
          if (id.includes('node_modules/@xterm')) {
            return 'xterm';
          }
          // Whiteboard — only pulled in when the panel is opened
          if (id.includes('node_modules/tldraw') || id.includes('node_modules/@tldraw')) {
            return 'tldraw';
          }
          // Diagram rendering — same, plus its heavy parser/layout deps
          if (
            id.includes('node_modules/mermaid') ||
            id.includes('node_modules/dagre') ||
            id.includes('node_modules/cytoscape') ||
            id.includes('node_modules/katex') ||
            id.includes('node_modules/d3')
          ) {
            return 'mermaid';
          }
          // Framer Motion
          if (id.includes('node_modules/framer-motion')) {
            return 'framer-motion';
          }
          // React core
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) {
            return 'react-dom';
          }
          // React ecosystem (router, hot-toast, etc.)
          if (id.includes('node_modules/react-')) {
            return 'react-ecosystem';
          }
          // Lucide icons
          if (id.includes('node_modules/lucide-react')) {
            return 'lucide';
          }
          // Everything else from node_modules
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        },
      },
    },
  },

  // Speed up dev server by pre-bundling known heavy deps
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
