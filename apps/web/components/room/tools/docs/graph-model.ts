import type { TreeNode } from "@codechatter/workspace-model";

import { isPageLink, titleOf, type PageRecord } from "./pages-model";

export type GraphNode = { id: string; kind: "page" | "file"; label: string; icon: string; fileId: string | null; degree: number };
export type GraphEdge = { source: string; target: string };
export type Graph = { nodes: GraphNode[]; edges: GraphEdge[]; key: string };

export const fileNodeId = (path: string) => `file:${path}`;

/**
 * Live pages, the files they link to, and one edge per linked pair. `key`
 * changes only when the shape changes (not on renames), so the layout isn't
 * restarted while someone types a title.
 */
export function buildGraph(pages: PageRecord[], files: TreeNode[]): Graph {
  const pageIds = new Set(pages.map((p) => p.id));
  const fileByPath = new Map(files.map((f) => [f.path, f]));
  const nodes = new Map<string, GraphNode>();
  for (const page of pages) nodes.set(page.id, { id: page.id, kind: "page", label: titleOf(page), icon: page.icon, fileId: null, degree: 0 });

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    for (const link of page.links) {
      let target: string;
      if (isPageLink(link)) {
        if (!pageIds.has(link) || link === page.id) continue;
        target = link;
      } else {
        const file = fileByPath.get(link);
        if (!file) continue;
        target = fileNodeId(link);
        if (!nodes.has(target)) nodes.set(target, { id: target, kind: "file", label: file.name, icon: "", fileId: file.id, degree: 0 });
      }
      const pair = page.id < target ? `${page.id}|${target}` : `${target}|${page.id}`;
      if (seen.has(pair)) continue;
      seen.add(pair);
      edges.push({ source: page.id, target });
      nodes.get(page.id)!.degree += 1;
      nodes.get(target)!.degree += 1;
    }
  }
  const list = [...nodes.values()];
  const key = JSON.stringify([list.map((n) => n.id).sort(), edges.map((e) => `${e.source}>${e.target}`).sort()]);
  return { nodes: list, edges, key };
}

export type View = { x: number; y: number; k: number };

/** The transform that fits every point in a width × height box with some margin. */
export function fitView(points: Array<{ x: number; y: number }>, width: number, height: number, margin = 60): View {
  if (points.length === 0 || width <= 0 || height <= 0) return { x: width / 2, y: height / 2, k: 1 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const k = Math.min(2, Math.max(0.2, Math.min((width - margin * 2) / Math.max(1, maxX - minX), (height - margin * 2) / Math.max(1, maxY - minY))));
  return { x: width / 2 - ((minX + maxX) / 2) * k, y: height / 2 - ((minY + maxY) / 2) * k, k };
}

/** Zoom by `factor` keeping the screen point (px, py) still. */
export function zoomAt(view: View, factor: number, px: number, py: number): View {
  const k = Math.min(4, Math.max(0.2, view.k * factor));
  const ratio = k / view.k;
  return { k, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio };
}
