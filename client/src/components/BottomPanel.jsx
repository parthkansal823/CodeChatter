export default function BottomPanel() {
  return (
    <div className="h-48 border-t border-zinc-800 bg-black flex flex-col">

      <div className="flex gap-6 px-4 py-2 border-b border-zinc-800 text-sm">

        <button>Terminal</button>
        <button>Output</button>
        <button>Errors</button>
        <button>Input</button>

        <div className="ml-auto flex gap-3">
          <button>Clear</button>
          <button>Copy</button>
        </div>

      </div>

      <div className="p-3 font-mono text-sm text-green-400 overflow-auto">
        $ Ready to run code...
      </div>

    </div>
  );
}