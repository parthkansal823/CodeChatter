import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, useState } from "react";
import { getFileVisual } from "../utils/fileIcons";

export default function TabBar({
  openFiles = [],
  activeFileId,
  modifiedFiles = new Set(),
  onSelectFile,
  onCloseFile,
}) {
  const [scrollOffset, setScrollOffset] = useState(0);
  const tabsContainerRef = useRef(null);

  const scroll = (direction) => {
    if (!tabsContainerRef.current) return;
    const container = tabsContainerRef.current;
    const scrollAmount = 200;
    const newOffset = direction === "left" 
      ? Math.max(0, scrollOffset - scrollAmount)
      : scrollOffset + scrollAmount;
    setScrollOffset(newOffset);
    container.scrollLeft = newOffset;
  };

  if (openFiles.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      {/* Scroll Left Button */}
      {scrollOffset > 0 && (
        <button
          onClick={() => scroll("left")}
          className="flex-shrink-0 p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
          title="Scroll left"
        >
          <ChevronLeft size={16} />
        </button>
      )}

      {/* Tabs Container */}
      <div
        ref={tabsContainerRef}
        className="flex min-w-0 flex-1 gap-0 overflow-x-auto scrollbar-hide"
      >
        {openFiles.map((file) => {
          const isActive = file.id === activeFileId;
          const isModified = modifiedFiles.has(file.id);
          const { Icon, className: iconClassName } = getFileVisual(file.name);

          return (
            <button
              key={file.id}
              onClick={() => onSelectFile?.(file)}
              className={`group relative flex min-w-[140px] max-w-[200px] items-center gap-2 border-r border-zinc-200 px-3 py-2 text-sm transition-colors dark:border-zinc-800 ${
                isActive
                  ? "bg-white text-zinc-900 dark:bg-zinc-900 dark:text-white"
                  : "bg-zinc-50 text-zinc-600 hover:bg-zinc-100 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900"
              }`}
              title={file.name}
            >
              {/* File Icon */}
              <Icon size={16} className={`flex-shrink-0 ${iconClassName}`} />

              {/* File Name */}
              <span className="min-w-0 truncate">{file.name}</span>

              {/* Modified Indicator */}
              {isModified && (
                <div
                  className="h-2 w-2 flex-shrink-0 rounded-full bg-orange-400"
                  title="Modified"
                />
              )}

              {/* Close Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseFile?.(file);
                }}
                className="ml-auto flex-shrink-0 rounded-sm p-0.5 text-zinc-400 opacity-0 transition-all hover:bg-zinc-300 hover:text-zinc-600 group-hover:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                title="Close file"
              >
                <X size={14} />
              </button>
            </button>
          );
        })}
      </div>

      {/* Scroll Right Button */}
      {openFiles.length > 4 && (
        <button
          onClick={() => scroll("right")}
          className="flex-shrink-0 p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
          title="Scroll right"
        >
          <ChevronRight size={16} />
        </button>
      )}
    </div>
  );
}
