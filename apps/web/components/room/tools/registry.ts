import type { RoomAction } from "@codechatter/contracts";
import type { TreeNode } from "@codechatter/workspace-model";
import type { LucideIcon } from "lucide-react";
import { NotebookText, PenTool, Presentation, Send, Sparkles } from "lucide-react";
import type { ComponentType } from "react";

/** What every room tool receives from the workspace. */
export type RoomToolProps = {
  /** The file open in the editor, if any (the AI uses it as context, docs can link it). */
  activeFile: TreeNode | null;
  /** Open a file from the room in the editor (switches back to code for main tools). */
  openFile: (fileId: string) => void;
  /** Close this tool. */
  close: () => void;
};

export type RoomTool = {
  id: string;
  label: string;
  icon: LucideIcon;
  /**
   * "side": a tab in the right panel, next to Chat and People.
   * "main": takes over the editor area while open (docs, API studio, design).
   */
  placement: "side" | "main";
  /** Hide the tool from roles that can't use it (default: everyone who can view the room). */
  visible?: (can: (action: RoomAction) => boolean) => boolean;
  /** Lazily loaded, so tools don't weigh down the room's first load. */
  load: () => Promise<{ default: ComponentType<RoomToolProps> }>;
};

/**
 * Tools that plug into every room. To add one: put its component in
 * components/room/tools/<id>/ (default export, RoomToolProps) and add one
 * entry here. The activity bar, side panel and main area pick it up.
 */
export const ROOM_TOOLS: RoomTool[] = [
  { id: "ai", label: "AI", icon: Sparkles, placement: "side", load: () => import("./ai/ai-panel") },
  { id: "docs", label: "Docs", icon: NotebookText, placement: "main", load: () => import("./docs/docs-tool") },
  { id: "api", label: "API", icon: Send, placement: "main", load: () => import("./api-studio/api-studio") },
  { id: "design", label: "Design", icon: PenTool, placement: "main", load: () => import("./design/design-tool") },
  { id: "board", label: "Whiteboard", icon: Presentation, placement: "main", load: () => import("./board/board-tool") },
];
