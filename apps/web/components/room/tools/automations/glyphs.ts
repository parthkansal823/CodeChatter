/** The icon on each kind of box on an automation's chart: the flow's own chart (flow-view.tsx) and an earlier version's (versions.tsx). */
import { Code2, GitBranch, Puzzle, Repeat, Rows3, Zap } from "lucide-react";

import type { FlowchartNode } from "@/components/flowchart/flowchart";

import type { Glyph } from "./model";

export const GLYPHS: Record<Glyph, FlowchartNode["icon"]> = { trigger: Zap, code: Code2, piece: Puzzle, router: GitBranch, loop: Repeat, data: Rows3 };
