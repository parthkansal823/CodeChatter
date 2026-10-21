import type { TEMPLATE_IDS } from "@codechatter/contracts";
import {
  Atom,
  Binary,
  Boxes,
  Braces,
  Compass,
  Database,
  FileText,
  Flame,
  FlaskConical,
  Gauge,
  Globe,
  Hexagon,
  Landmark,
  Layers,
  Orbit,
  Rocket,
  Server,
  Triangle,
  Users,
  Wind,
  Zap,
  type LucideIcon,
} from "lucide-react";

/** The API's list, so a new template can't be offered here without the server knowing it. */
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export const TEMPLATES: Array<{ id: TemplateId; name: string; description: string; icon: LucideIcon }> = [
  { id: "blank", name: "Blank", description: "An empty room. Add files as you go.", icon: FileText },
  {
    id: "python",
    name: "Python",
    description: "main.py, a test file and pytest ready to run.",
    icon: Braces,
  },
  {
    id: "node",
    name: "Node.js API",
    description: "A JSON API on Node's http module. Run it and open the preview.",
    icon: Server,
  },
  { id: "web", name: "Web page", description: "HTML, CSS and JavaScript with live preview.", icon: Globe },
  {
    id: "react",
    name: "React (Vite)",
    description: "React with Vite's dev server: Start, then the preview updates as you type.",
    icon: Atom,
  },
  {
    id: "vue",
    name: "Vue (Vite)",
    description: "Vue with Vite's dev server: Start, then the preview updates as you type.",
    icon: Layers,
  },
  {
    id: "svelte",
    name: "Svelte (Vite)",
    description: "Svelte 5 with Vite's dev server: Start, then the preview updates as you type.",
    icon: Flame,
  },
  {
    id: "nextjs",
    name: "Next.js",
    description: "The App Router with a client component: Start, then the preview updates as you save.",
    icon: Triangle,
  },
  {
    id: "sveltekit",
    name: "SvelteKit",
    description: "Pages in src/routes on Vite: Start, then the preview updates as you type.",
    icon: Orbit,
  },
  {
    id: "astro",
    name: "Astro",
    description: "A content site with a page and a little script: Start, then open the preview.",
    icon: Rocket,
  },
  {
    id: "solid",
    name: "Solid (Vite)",
    description: "SolidJS signals with Vite's dev server: Start, then the preview updates as you type.",
    icon: Hexagon,
  },
  {
    id: "fastify",
    name: "Fastify",
    description: "A fast Node.js JSON API that restarts on every save.",
    icon: Gauge,
  },
  {
    id: "hono",
    name: "Hono",
    description: "Hono on Node.js: a small, fast API that restarts on every save.",
    icon: Wind,
  },
  {
    id: "express-postgres",
    name: "Express and PostgreSQL",
    description: "A notes API kept in the room's own PostgreSQL, started with it.",
    icon: Database,
  },
  {
    id: "fastapi",
    name: "FastAPI",
    description: "A Python JSON API with interactive docs, reloading on every save.",
    icon: Zap,
  },
  {
    id: "flask",
    name: "Flask",
    description: "A Python web app and JSON API, reloading on every save.",
    icon: FlaskConical,
  },
  {
    id: "django",
    name: "Django",
    description: "A Django project with a pages app, ready to grow.",
    icon: Landmark,
  },
  {
    id: "dsa",
    name: "DSA practice",
    description: "A problem, starter code in your language and tests.",
    icon: Binary,
  },
  {
    id: "interview",
    name: "Interview",
    description: "A timed session with hidden tests and a private rubric.",
    icon: Users,
  },
  {
    id: "tour",
    name: "Guided tour",
    description: "Every feature in one room: run, tests, preview, terminal, servers.",
    icon: Compass,
  },
  {
    id: "kubernetes",
    name: "Kubernetes playground",
    description: "A real Kubernetes API in the sandbox: kubectl, Helm and sample manifests.",
    icon: Boxes,
  },
];

export const templateName = (id: string | null) => TEMPLATES.find((t) => t.id === id)?.name ?? "Blank";
