/** Mark parsed Mermaid fences so Markdown can replace their pre element without reparsing source or confusing inline code. */
type Node = {
  type?: unknown;
  lang?: unknown;
  value?: unknown;
  tagName?: unknown;
  properties?: Record<string, unknown>;
  data?: { hProperties?: Record<string, unknown> };
  children?: unknown[];
};

const nodeOf = (value: unknown): Node | null => value !== null && typeof value === "object" ? value as Node : null;

/** Work on the Markdown tree, including fences inside quotes and lists; identical fences remain separate blocks. */
export function markMermaidBlocks(tree: unknown): void {
  let index = 0;
  function visit(value: unknown) {
    const node = nodeOf(value);
    if (!node) return;
    if (node.type === "code" && typeof node.lang === "string" && node.lang.toLowerCase() === "mermaid" && typeof node.value === "string") {
      node.data = {
        ...node.data,
        hProperties: {
          ...node.data?.hProperties,
          "data-mermaid-index": ++index,
          "data-mermaid-source": node.value,
        },
      };
    }
    for (const child of node.children ?? []) visit(child);
  }
  visit(tree);
}

/** A remark plugin uses the parser's code value, preserving blank lines rather than trimming the block. */
export function remarkMermaidBlocks() {
  return markMermaidBlocks;
}

/** Read only our marked fenced code; replacing pre avoids placing a diagram section inside a pre or paragraph. */
export function mermaidBlockOf(value: unknown): { text: string; index: number } | null {
  const node = nodeOf(value);
  if (node?.tagName !== "pre") return null;
  const code = node.children?.map(nodeOf).find((child) => child?.tagName === "code");
  const properties = code?.properties;
  const source = properties?.["data-mermaid-source"] ?? properties?.dataMermaidSource;
  const index = Number(properties?.["data-mermaid-index"] ?? properties?.dataMermaidIndex);
  return typeof source === "string" && Number.isSafeInteger(index) && index > 0 ? { text: source, index } : null;
}
