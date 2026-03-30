import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getFileVisual } from "../utils/fileIcons";

export default function TabBar({
  openFiles = [],
  activeFileId,
  modifiedFiles = new Set(),
  onSelectFile,
  onCloseFile,
}) {
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const tabsContainerRef = useRef(null);

  const updateScrollState = () => {
    const el = tabsContainerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  };

  useEffect(() => {
    const el = tabsContainerRef.current;
    if (!el) return;

    updateScrollState();
    el.addEventListener("scroll", updateScrollState);
    window.addEventListener("resize", updateScrollState);

    return () => {
      el.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
    };
  }, [openFiles]);

  const scroll = (direction) => {
    const el = tabsContainerRef.current;
    if (!el) return;
    el.scrollBy({ left: direction === "left" ? -200 : 200, behavior: "smooth" });
  };

  if (openFiles.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center border-b border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-[#18181b]">
      {canScrollLeft && (
        <button
          onClick={() => scroll("left")}
          className="flex-shrink-0 p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
          title="Scroll left"
        >
          <ChevronLeft size={16} />
        </button>
      )}

      <div
        ref={tabsContainerRef}
        className="flex min-w-0 flex-1 gap-0 overflow-x-auto scrollbar-hide"
      >
        {openFiles.map((file) => {
          const isActive = file.id === activeFileId;
          const isModified = modifiedFiles.has(file.id);
          const { Icon, className: iconClassName } = getFileVisual(file.name);

          return (
            <div
              key={file.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectFile?.(file)}
              onKeyDown={(e) => e.key === "Enter" && onSelectFile?.(file)}
              className={`group relative flex min-w-[120px] max-w-[220px] cursor-pointer items-center gap-2 border-t-2 px-3 py-1.5 text-sm transition-colors ${
                isActive
                  ? "border-t-brand-500 bg-white text-zinc-900 dark:bg-[#1e1e1e] dark:text-white"
                  : "border-t-transparent bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-[#18181b] dark:text-zinc-400 dark:hover:bg-[#1d1d20]"
              }`}
              title={file.name}
            >
              <Icon size={16} className={`flex-shrink-0 ${iconClassName}`} />
              <span className="min-w-0 truncate">{file.name}</span>

              {isModified && (
                <div
                  className="h-2 w-2 flex-shrink-0 rounded-full bg-orange-400"
                  title="Modified"
                />
              )}

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseFile?.(file);
                }}
                className="ml-auto flex-shrink-0 rounded-sm p-0.5 text-zinc-400 opacity-0 transition-all hover:bg-zinc-200 hover:text-zinc-700 group-hover:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                title="Close file"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>

      {canScrollRight && (
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
