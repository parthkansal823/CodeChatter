import { MessageCircle, Video, Brain, Pencil } from "lucide-react";

export default function RightSidebar() {
  return (
    <div className="group w-14 hover:w-56 transition-all duration-300 border-l border-zinc-800 bg-[#111]">

      <div className="flex flex-col gap-6 p-3">

        <div className="flex items-center gap-3 cursor-pointer">
          <MessageCircle />
          <span className="opacity-0 group-hover:opacity-100">
            Chat
          </span>
        </div>

        <div className="flex items-center gap-3 cursor-pointer">
          <Video />
          <span className="opacity-0 group-hover:opacity-100">
            Video
          </span>
        </div>

        <div className="flex items-center gap-3 cursor-pointer">
          <Brain />
          <span className="opacity-0 group-hover:opacity-100">
            AI Review
          </span>
        </div>

        <div className="flex items-center gap-3 cursor-pointer">
          <Pencil />
          <span className="opacity-0 group-hover:opacity-100">
            Whiteboard
          </span>
        </div>

      </div>
    </div>
  );
}