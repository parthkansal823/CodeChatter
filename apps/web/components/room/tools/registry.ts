import type { RoomAction, RoomSummary } from "@codechatter/contracts";
import type { TreeNode } from "@codechatter/workspace-model";
import type { LucideIcon } from "lucide-react";
import { Activity, BookMarked, Boxes, ClipboardList, Database, FlaskConical, GitFork, NotebookPen, NotebookText, PenTool, Plug, Presentation, ScanSearch, Send, ShieldAlert, Sparkles, Warehouse, Workflow, Zap } from "lucide-react";
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

/** Where an app sits in the Apps list (apps-launcher.tsx). */
export const APP_GROUPS = ["Write and plan", "Data", "Build and run", "Check and improve"] as const;
export type AppGroup = (typeof APP_GROUPS)[number];

export type RoomTool = {
  id: string;
  label: string;
  icon: LucideIcon;
  /** One line on what it's for, in the Apps list. */
  description: string;
  /** A main app's place in the Apps list; side ones are listed as "Beside the code". */
  group?: AppGroup;
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
  { id: "interview", label: "Interview", icon: ClipboardList, description: "The questions, the timer and the tests", placement: "side", visible: (_can, room) => room.kind === "interview", load: () => import("./interview/interview-tool") },
  // AI help is off for a candidate unless their interviewer allows it (the API refuses it, too).
  { id: "ai", label: "AI", icon: Sparkles, description: "Ask about the code, or have it write some", placement: "side", visible: (_can, _room, { candidateAiOff }) => !candidateAiOff, load: () => import("./ai/ai-panel") },
  { id: "notes", label: "Notes", icon: NotebookPen, description: "Notes everyone in the room shares", placement: "side", load: () => import("./notes/notes-tool") },
  { id: "activity", label: "Activity", icon: Activity, description: "What's happened in the room this week", placement: "side", load: () => import("./activity/activity-tool") },
  { id: "dependencies", label: "Dependencies", icon: ShieldAlert, description: "Known problems in the packages the code uses", placement: "side", load: () => import("./dependencies/dependencies-tool") },
  // Only shown in the Research layout, or in a room with a .bib file (room-workspace.tsx).
  { id: "references", label: "References", icon: BookMarked, description: "The sources a paper cites", placement: "side", visible: (_can, room) => room.kind !== "interview", load: () => import("./references/references-tool") },
  {
    id: "docs",
    label: "Docs",
    icon: NotebookText, description: "Pages written together, like Notion", group: "Write and plan",
    placement: "main",
    load: () => import("./docs/docs-tool"),
  },
  { id: "api", label: "API", icon: Send, description: "Send requests and keep them, like Postman", group: "Build and run", placement: "main", load: () => import("./api-studio/api-studio") },
  { id: "tasks", label: "Tasks", icon: ClipboardList, description: "A board of what's left, with the code's TODOs", group: "Write and plan", placement: "main", load: () => import("./tasks/tasks-tool") },
  {
    id: "analysis",
    label: "Analysis",
    icon: ScanSearch, description: "Linters, security checks and secrets, across the code", group: "Check and improve",
    placement: "main",
    // It runs tools in the sandbox, and an interview isn't the place for it.
    visible: (can, room) => can("code.run") && room.kind !== "interview",
    load: () => import("./analysis/analysis-tool"),
  },
  {
    id: "prompts",
    label: "Prompts",
    icon: FlaskConical, description: "Try prompts on models and compare the answers", group: "Check and improve",
    placement: "main",
    // Trying models isn't part of an interview, whatever the interviewer decides about the AI panel.
    visible: (can, room) => can("room.chat") && room.kind !== "interview",
    load: () => import("./prompts/prompts-tool"),
  },
  {
    id: "mcp",
    label: "MCP",
    icon: Plug, description: "Try MCP servers with the Inspector", group: "Build and run",
    placement: "main",
    // It starts programs in the sandbox, and an interview isn't the place for it.
    visible: (can, room) => can("code.run") && room.kind !== "interview",
    load: () => import("./mcp/mcp-tool"),
  },
  {
    id: "databases",
    label: "Databases",
    icon: Database, description: "Postgres, MySQL, MongoDB, Redis and SQLite, with a console", group: "Data",
    placement: "main",
    load: () => import("./databases/databases-tool"),
  },
  {
    id: "lakehouse",
    label: "Lakehouse",
    icon: Warehouse, description: "Spark, Delta Lake tables and MLflow runs", group: "Data",
    placement: "main",
    // It reads in the sandbox, and an interview isn't the place for it.
    visible: (can, room) => can("code.run") && room.kind !== "interview",
    load: () => import("./lakehouse/lakehouse-tool"),
  },
  {
    id: "flow",
    label: "Flow",
    icon: GitFork, description: "dbt's datasets and checks, on a chart", group: "Data",
    placement: "main",
    // dbt runs the room's recipes in the sandbox, and an interview isn't the place for it.
    visible: (can, room) => can("code.run") && room.kind !== "interview",
    load: () => import("./flow/flow-tool"),
  },
  {
    id: "automations",
    label: "Automations",
    icon: Zap, description: "Flows that run by themselves, like n8n", group: "Build and run",
    placement: "main",
    // A flow runs in the sandbox, and an interview isn't the place for it.
    visible: (can, room) => can("code.run") && room.kind !== "interview",
    load: () => import("./automations/automations-tool"),
  },
  {
    id: "kubernetes",
    label: "Kubernetes",
    icon: Boxes, description: "The room's own cluster, and what runs in it", group: "Build and run",
    placement: "main",
    // Using the room's cluster is running code in its sandbox.
    visible: (can) => can("code.run"),
    load: () => import("./kubernetes/kubernetes-tool"),
  },
  {
    id: "design",
    label: "Design",
    icon: PenTool, description: "Screens and layouts, drawn together", group: "Write and plan",
    placement: "main",
    load: () => import("./design/design-tool"),
  },
  {
    id: "board",
    label: "Whiteboard",
    icon: Presentation, description: "A whiteboard to sketch on together", group: "Write and plan",
    placement: "main",
    load: () => import("./board/board-tool"),
  },
  {
    id: "diagrams",
    label: "Diagrams",
    icon: Workflow, description: "Diagrams with draw.io", group: "Write and plan",
    placement: "main",
    load: () => import("./diagrams/diagrams-tool"),
  },
];
