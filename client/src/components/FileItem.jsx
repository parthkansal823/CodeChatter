import { File } from "lucide-react";

export default function FileItem({ name }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 hover:bg-zinc-800 cursor-pointer">

      <File size={16} />

      <span className="opacity-0 group-hover:opacity-100 text-sm">
        {name}
      </span>

    </div>
  );
}