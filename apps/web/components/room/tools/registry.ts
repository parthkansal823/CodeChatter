import type { RoomAction, RoomSummary } from "@codechatter/contracts";
import type { TreeNode } from "@codechatter/workspace-model";
import type { LucideIcon } from "lucide-react";
import { Activity, BookMarked, Boxes, ClipboardList, Database, FlaskConical, GitFork, NotebookPen, NotebookText, PenTool, Plug, Presentation, ScanSearch, Send, ShieldAlert, Sparkles, Warehouse, Workflow } from "lucide-react";
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
  visible?: (can: (action: RoomAction) => boolean, room: Pick<RoomSummary, "kind" | "role">, context: { candidateAiOff: boolean }) => boolean;
  /** Lazily loaded, so tools don't weigh down the room's first load. */
  load: () => Promise<{ default: ComponentType<RoomToolProps> }>;
};

/**
 * Tools that plug into every room. To add one: put its component in
 * components/room/tools/<id>/ (default export, RoomToolProps) and add one
 * entry here. The activity bar, side panel and main area pick it up.
 */
export const ROOM_TOOLS: RoomTool[] = [
  { id: "interview", label: "Interview", icon: ClipboardList, placement: "side", visible: (_can, room) => room.kind === "interview", load: () => import("./interview/interview-tool") },
  // AI help is off for a candidate unless their interviewer allows it (the API refuses it, too).
  { id: "ai", label: "AI", icon: Sparkles, placement: "side", visible: (_can, _room, { candidateAiOff }) => !candidateAiOff, load: () => import("./ai/ai-panel") },
  { id: "notes", label: "Notes", icon: NotebookPen, placement: "side", load: () => import("./notes/notes-tool") },
  { id: "activity", label: "Activity", icon: Activity, placement: "side", load: () => import("./activity/activity-tool") },
  { id: "dependencies", label: "Dependencies", icon: ShieldAlert, placement: "side", load: () => import("./dependencies/dependencies-tool") },
  // Only shown in the Research layout, or in a room with a .bib file (room-workspace.tsx).
  { id: "references", label: "References", icon: BookMarked, placement: "side", visible: (_can, room) => room.kind !== "interview", load: () => import("./references/references-tool") },
  {
    id: "docs",
    label: "Docs",
    icon: NotebookText,
    placement: "main",
    load: () => import("./docs/docs-tool"),
  },
  { id: "api", label: "API", icon: Send, placement: "main", load: () => import("./api-studio/api-studio") },
  { id: "tasks", label: "Tasks", icon: ClipboardList, placement: "main", load: () => import("./tasks/tasks-tool") },
  {
    id: "analysis",
    label: "Analysis",
    icon: ScanSearch,
    placement: "main",
    // It runs tools in the sandbox, and an interview isn't the place for it.
    visible: (can, room) => can("code.run") && room.kind !== "interview",
    load: () => import("./analysis/analysis-tool"),
  },
  {
    id: "prompts",
    label: "Prompts",
    icon: FlaskConical,
    placement: "main",
    // Trying models isn't part of an interview, whatever the interviewer decides about the AI panel.
    visible: (can, room) => can("room.chat") && room.kind !== "interview",
    load: () => import("./prompts/prompts-tool"),
  },
  {
    id: "mcp",
    label: "MCP",
    icon: Plug,
    placement: "main",
    // It starts programs in the sandbox, and an interview isn't the place for it.
    visible: (can, room) => can("code.run") && room.kind !== "interview",
    load: () => import("./mcp/mcp-tool"),
  },
  {
    id: "databases",
    label: "Databases",
    icon: Database,
    placement: "main",
    load: () => import("./databases/databases-tool"),
  },
  {
    id: "lakehouse",
    label: "Lakehouse",
    icon: Warehouse,
    placement: "main",
    // It reads in the sandbox, and an interview isn't the place for it.
    visible: (can, room) => can("code.run") && room.kind !== "interview",
    load: () => import("./lakehouse/lakehouse-tool"),
  },
  {
    id: "flow",
    label: "Flow",
    icon: GitFork,
    placement: "main",
    // dbt runs the room's recipes in the sandbox, and an interview isn't the place for it.
    visible: (can, room) => can("code.run") && room.kind !== "interview",
    load: () => import("./flow/flow-tool"),
  },
  {
    id: "kubernetes",
    label: "Kubernetes",
    icon: Boxes,
    placement: "main",
    // Using the room's cluster is running code in its sandbox.
    visible: (can) => can("code.run"),
    load: () => import("./kubernetes/kubernetes-tool"),
  },
  {
    id: "design",
    label: "Design",
    icon: PenTool,
    placement: "main",
    load: () => import("./design/design-tool"),
  },
  {
    id: "board",
    label: "Whiteboard",
    icon: Presentation,
    placement: "main",
    load: () => import("./board/board-tool"),
  },
  {
    id: "diagrams",
    label: "Diagrams",
    icon: Workflow,
    placement: "main",
    load: () => import("./diagrams/diagrams-tool"),
  },
];
