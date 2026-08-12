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
    <div className="flex items-center border-b border-edge-subtle bg-hovered">
      {canScrollLeft && (
        <button
          onClick={() => scroll("left")}
          className="flex-shrink-0 p-1.5 text-fg-subtle hover:text-fg-muted transition-colors"
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
              className={`group relative flex min-w-[110px] max-w-[220px] cursor-pointer items-center gap-2 border-t-2 px-2.5 py-1.5 text-xs transition-colors sm:min-w-[120px] sm:px-3 sm:text-sm ${
 isActive
 ?"border-t-brand-500 bg-panel text-fg"
                  : "border-t-transparent bg-hovered text-fg-muted hover:bg-selected"
              }`}
              title={file.name}
            >
              <Icon size={16} className={`flex-shrink-0 ${iconClassName}`} />
              <span className="min-w-0 truncate">{file.name}</span>

              {isModified && (
                <div
                  className="h-2 w-2 flex-shrink-0 rounded-full bg-warning-400"
                  title="Modified"
                />
              )}

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseFile?.(file);
                }}
                className={`ml-auto flex-shrink-0 rounded-sm p-0.5 text-fg-subtle transition-all hover:bg-selected hover:text-fg ${isActive ?"opacity-100" : "opacity-0 group-hover:opacity-100"}`}
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
          className="flex-shrink-0 p-1.5 text-fg-subtle hover:text-fg-muted transition-colors"
          title="Scroll right"
        >
          <ChevronRight size={16} />
        </button>
      )}
    </div>
  );
}
