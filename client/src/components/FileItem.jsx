import { Trash2 } from "lucide-react";
import { useState } from "react";

import {
  SiJavascript,
  SiCplusplus,
  SiPython,
  SiHtml5,
  SiMarkdown
} from "react-icons/si";

import { VscJson } from "react-icons/vsc";
import { DiCss3 } from "react-icons/di";
import { FiFile } from "react-icons/fi";

export default function FileItem({
  name,
  onSelect,
  isSelected = false,
  onDelete
}) {

  const [isHovering, setIsHovering] = useState(false);

  // safer extension detection
  const extension = name.includes(".")
    ? name.split(".").pop().toLowerCase()
    : "";

  const getIcon = () => {

    switch (extension) {

      case "js":
      case "jsx":
        return <SiJavascript className="text-yellow-500" size={16} />;

      case "cpp":
      case "c":
        return <SiCplusplus className="text-blue-500" size={16} />;

      case "py":
        return <SiPython className="text-yellow-400" size={16} />;

      case "html":
        return <SiHtml5 className="text-orange-500" size={16} />;

      case "css":
        return <DiCss3 className="text-blue-500" size={16} />;

      case "json":
        return <VscJson className="text-yellow-400" size={16} />;

      case "md":
        return <SiMarkdown className="text-purple-500" size={16} />;

      case "txt":
        return <FiFile className="text-zinc-400" size={16} />;

      default:
        return <FiFile className="text-zinc-400" size={16} />;
    }

  };

  return (
    <div
      className={`flex items-center justify-between gap-3 px-3 py-2 cursor-pointer transition-colors
      ${
        isSelected
          ? "bg-blue-500/20"
          : "hover:bg-zinc-200 dark:hover:bg-zinc-800"
      }`}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      aria-label={`File: ${name}`}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSelect();
      }}
    >

      {/* File Icon + Name */}
      <div className="flex items-center gap-3 min-w-0">

        <div className="flex-shrink-0">
          {getIcon()}
        </div>

        <span className="text-sm truncate text-zinc-800 dark:text-zinc-200">
          {name}
        </span>

      </div>

      {/* Delete Button */}
      {isHovering && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="p-1 hover:bg-red-600 rounded transition"
          title="Delete file"
        >
          <Trash2 size={14} className="text-red-400" />
        </button>
      )}

    </div>
  );
}
