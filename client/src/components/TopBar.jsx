import { Play, Github, Share2, LogOut } from "lucide-react";

export default function TopBar() {
  return (
    <div className="h-14 border-b border-zinc-800 flex items-center justify-between px-6">

      <div className="flex items-center gap-6">
        <span className="font-semibold">Room: AB123</span>
        <span className="text-zinc-400 text-sm">Users (3)</span>
      </div>

      <div className="flex items-center gap-4">

        <select className="bg-zinc-900 px-2 py-1 rounded">
          <option>JavaScript</option>
          <option>C++</option>
          <option>Python</option>
        </select>

        <select className="bg-zinc-900 px-2 py-1 rounded">
          <option>Dark</option>
          <option>Light</option>
        </select>

        <button className="flex items-center gap-1 bg-green-600 px-3 py-1 rounded hover:bg-green-500">
          <Play size={16} /> Run
        </button>

        <button>
          <Github />
        </button>

        <button>
          <Share2 />
        </button>

        <button>
          <LogOut />
        </button>

      </div>
    </div>
  );
}