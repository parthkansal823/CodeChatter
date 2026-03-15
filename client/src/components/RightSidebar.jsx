import {
  MessageCircle,
  Video,
  Brain,
  Pencil
} from "lucide-react";

import { useState } from "react";

export default function RightSidebar() {

  const [isExpanded, setIsExpanded] = useState(false);

  const features = [
    { name: "Chat", icon: MessageCircle, color: "text-green-500" },
    { name: "Video", icon: Video, color: "text-blue-500" },
    { name: "AI Review", icon: Brain, color: "text-purple-500" },
    { name: "Whiteboard", icon: Pencil, color: "text-yellow-500" }
  ];

  return (
    <div
      onMouseEnter={() => setIsExpanded(true)}
      onMouseLeave={() => setIsExpanded(false)}
      className={`flex flex-col items-center transition-all duration-300
      border-l border-zinc-300 dark:border-zinc-800
      bg-white dark:bg-zinc-950
      ${isExpanded ? "w-56" : "w-14"}`}
    >

      <div className="flex flex-col gap-4 py-4 w-full">

        {features.map(({ name, icon: Icon, color }) => (

          <div
            key={name}
            className="flex items-center gap-3 px-3 py-2
            text-zinc-600 dark:text-zinc-400
            hover:bg-zinc-200 dark:hover:bg-zinc-800
            cursor-default rounded transition"
            title={`${name} (coming soon)`}
          >

            <Icon size={20} className={color} />

            {isExpanded && (
              <span className="text-sm font-medium">
                {name}
              </span>
            )}

          </div>

        ))}

      </div>

    </div>
  );
}
