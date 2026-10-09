import type { TEMPLATE_IDS } from "@codechatter/contracts";
import { Binary, Boxes, Braces, Compass, FileText, Globe, Server, Users, type LucideIcon } from "lucide-react";

/** The API's list, so a new template can't be offered here without the server knowing it. */
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export const TEMPLATES: Array<{ id: TemplateId; name: string; description: string; icon: LucideIcon }> = [
  { id: "blank", name: "Blank", description: "An empty room. Add files as you go.", icon: FileText },
  { id: "python", name: "Python", description: "main.py, a test file and pytest ready to run.", icon: Braces },
  { id: "node", name: "Node.js API", description: "A JSON API on Node's http module. Run it and open the preview.", icon: Server },
  { id: "web", name: "Web page", description: "HTML, CSS and JavaScript with live preview.", icon: Globe },
  { id: "dsa", name: "DSA practice", description: "A problem, starter code in your language and tests.", icon: Binary },
  { id: "interview", name: "Interview", description: "A timed session with hidden tests and a private rubric.", icon: Users },
  { id: "tour", name: "Guided tour", description: "Every feature in one room: run, tests, preview, terminal, servers.", icon: Compass },
  { id: "kubernetes", name: "Kubernetes playground", description: "A real Kubernetes API in the sandbox: kubectl, Helm and sample manifests.", icon: Boxes },
];

export const templateName = (id: string | null) => TEMPLATES.find((t) => t.id === id)?.name ?? "Blank";
