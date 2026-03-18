import {
  Bot,
  ChevronRight,
  MessageCircleMore,
  PencilRuler,
  Video,
  X,
} from "lucide-react";

const TOOL_CARDS = [
  {
    id: "chat",
    name: "Room Chat",
    description: "Keep conversation tied to the active workspace and files.",
    icon: MessageCircleMore,
    accent: "text-emerald-500",
  },
  {
    id: "video",
    name: "Video Call",
    description: "Jump into a quick call when text is not enough.",
    icon: Video,
    accent: "text-sky-500",
  },
  {
    id: "ai",
    name: "AI Help",
    description: "Explain code, break down logic, and help understand the current file.",
    icon: Bot,
    accent: "text-violet-500",
  },
  {
    id: "whiteboard",
    name: "Whiteboard",
    description: "Sketch flows, system ideas, and architecture beside the editor.",
    icon: PencilRuler,
    accent: "text-amber-500",
  },
];

export default function RightSidebar({
  isOpen = true,
  onToggle,
  mobile = false,
  onClose,
  onFeatureSelect,
}) {
  if (mobile && !isOpen) {
    return null;
  }

  const isCollapsed = !mobile && !isOpen;

  const panel = (
    <div
      className={`flex h-full flex-col border-l border-zinc-200/80 bg-zinc-50/80 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/70 ${
        mobile
          ? "w-[82vw] max-w-[340px] shadow-2xl shadow-zinc-950/20"
          : isCollapsed
            ? "w-16"
            : "w-80"
      }`}
    >
      <div className="flex items-center justify-between border-b border-zinc-200/80 px-3 py-3 dark:border-zinc-800">
        <div className="flex min-w-0 items-center gap-2">
          {!mobile && (
            <button
              onClick={onToggle}
              className="rounded-xl p-2 text-zinc-500 transition-colors hover:bg-white hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-white"
              title={isCollapsed ? "Expand tools" : "Collapse tools"}
            >
              <ChevronRight size={16} className={`transition-transform ${isCollapsed ? "rotate-180" : ""}`} />
            </button>
          )}

          {!isCollapsed && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-400 dark:text-zinc-500">
                Workspace
              </p>
              <p className="text-sm font-semibold text-zinc-900 dark:text-white">
                Tools
              </p>
            </div>
          )}
        </div>

        {mobile && (
          <button
            onClick={onClose}
            className="rounded-xl p-2 text-zinc-500 transition-colors hover:bg-white hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-white"
            title="Close tools"
          >
            <X size={16} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {isCollapsed ? (
          <div className="space-y-2">
            {TOOL_CARDS.map((tool) => (
              <button
                key={tool.id}
                onClick={() => onFeatureSelect?.(tool.id)}
                className="flex h-11 w-full items-center justify-center rounded-2xl text-zinc-500 transition-colors hover:bg-white hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-white"
                title={tool.name}
              >
                <tool.icon size={18} className={tool.accent} />
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-400 dark:text-zinc-500">
                Feature Dock
              </p>
              <p className="mt-2 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                Keep this panel for collaboration and helper tools around the editor.
              </p>
            </div>

            <div className="space-y-3">
              {TOOL_CARDS.map((tool) => (
                <button
                  key={tool.id}
                  onClick={() => onFeatureSelect?.(tool.id)}
                  className="w-full rounded-3xl border border-zinc-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 flex h-11 w-11 items-center justify-center rounded-2xl bg-zinc-50 dark:bg-zinc-950 ${tool.accent}`}>
                      <tool.icon size={19} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-zinc-900 dark:text-white">
                          {tool.name}
                        </p>
                        <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
                          Coming soon
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                        {tool.description}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (mobile) {
    return (
      <div className="fixed inset-0 z-50 flex justify-end lg:hidden">
        <button
          className="flex-1 bg-zinc-950/40 backdrop-blur-sm"
          onClick={onClose}
          aria-label="Close tools"
        />
        {panel}
      </div>
    );
  }

  return panel;
}
