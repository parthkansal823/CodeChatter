import type { JSONContent } from "@tiptap/react";

import type { WikiAttrs } from "./extensions/wiki-link";

export type Resolve = { pageTitle: (id: string) => string | null; filePath: (id: string) => string | null };

/** Names for [[links]] from the tool's live state. */
export const resolverFor = (docs: { byId: Map<string, { title: string }>; files: Array<{ id: string; path: string }> }): Resolve => ({
  pageTitle: (id) => {
    const page = docs.byId.get(id);
    return page ? page.title.trim() || "Untitled" : null;
  },
  filePath: (id) => docs.files.find((file) => file.id === id)?.path ?? null,
});

const escapeText = (text: string) => text.replace(/([\\`*[\]])/g, "\\$1");

/** Wrap text in a Markdown delimiter, keeping edge spaces outside it (`** bold**` isn't bold). */
function wrap(text: string, open: string, close = open): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  const [, lead = "", core = "", trail = ""] = match ?? [];
  return core ? `${lead}${open}${core}${close}${trail}` : text;
}

function inline(nodes: JSONContent[] | undefined, resolve: Resolve): string {
  return (nodes ?? [])
    .map((node) => {
      if (node.type === "hardBreak") return "\\\n";
      if (node.type === "wikiLink") {
        const attrs = node.attrs as WikiAttrs;
        const label = attrs.kind === "page" ? (resolve.pageTitle(attrs.target) ?? attrs.label) : (resolve.filePath(attrs.target) ?? attrs.path ?? attrs.label);
        return `[[${label}]]`;
      }
      if (node.type !== "text" || !node.text) return "";
      const marks = new Set((node.marks ?? []).map((mark) => mark.type));
      let text = marks.has("code") ? `\`${node.text.replace(/`/g, "\\`")}\`` : escapeText(node.text);
      if (marks.has("bold")) text = wrap(text, "**");
      if (marks.has("italic")) text = wrap(text, "_");
      if (marks.has("strike")) text = wrap(text, "~~");
      const link = node.marks?.find((mark) => mark.type === "link");
      if (typeof link?.attrs?.href === "string") text = `[${text}](${link.attrs.href})`;
      return text;
    })
    .join("");
}

const indent = (text: string, prefix: string, first = prefix) =>
  text
    .split("\n")
    .map((line, i) => (i === 0 ? first : line ? prefix : prefix.trimEnd()) + line)
    .join("\n");

function listItems(node: JSONContent, marker: (index: number, item: JSONContent) => string, resolve: Resolve): string {
  return (node.content ?? [])
    .map((item, index) => {
      const bullet = marker(index, item);
      return indent(blocks(item.content, resolve, "\n"), " ".repeat(bullet.length), bullet);
    })
    .join("\n");
}

function cell(node: JSONContent, resolve: Resolve): string {
  return (node.content ?? [])
    .map((child) => inline(child.content, resolve))
    .join("<br>")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, "<br>");
}

function table(node: JSONContent, resolve: Resolve): string {
  const rows = (node.content ?? []).map((row) => (row.content ?? []).map((c) => cell(c, resolve)));
  const width = Math.max(1, ...rows.map((row) => row.length));
  const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`;
  const [head = [], ...body] = rows;
  return [line(head), line(Array.from({ length: width }, () => "---")), ...body.map(line)].join("\n");
}

function block(node: JSONContent, resolve: Resolve): string {
  switch (node.type) {
    case "paragraph":
      return inline(node.content, resolve);
    case "heading":
      return `${"#".repeat(Number(node.attrs?.level) || 1)} ${inline(node.content, resolve)}`;
    case "blockquote":
      return indent(blocks(node.content, resolve), "> ");
    case "callout": {
      const kind = node.attrs?.kind === "warning" ? "WARNING" : "NOTE";
      return indent(`[!${kind}]\n${blocks(node.content, resolve)}`, "> ");
    }
    case "bulletList":
      return listItems(node, () => "- ", resolve);
    case "orderedList": {
      const start = Number(node.attrs?.start) || 1;
      return listItems(node, (i) => `${start + i}. `, resolve);
    }
    case "taskList":
      return listItems(node, (_, item) => (item.attrs?.checked ? "- [x] " : "- [ ] "), resolve);
    case "codeBlock": {
      const code = (node.content ?? []).map((child) => child.text ?? "").join("");
      const fence = code.includes("```") ? "````" : "```";
      return `${fence}${node.attrs?.language ?? ""}\n${code}\n${fence}`;
    }
    case "horizontalRule":
      return "---";
    case "table":
      return table(node, resolve);
    default:
      return node.content ? blocks(node.content, resolve) : inline([node], resolve);
  }
}

function blocks(nodes: JSONContent[] | undefined, resolve: Resolve, gap = "\n\n"): string {
  return (nodes ?? []).map((node) => block(node, resolve)).join(gap);
}

/** A page as GitHub-flavoured Markdown, with [[wiki links]] kept as text. */
export function toMarkdown(title: string, doc: JSONContent, resolve: Resolve): string {
  const body = blocks(doc.content, resolve).replace(/\n{3,}/g, "\n\n").trim();
  return `# ${escapeText(title)}\n\n${body}\n`;
}

export function downloadText(filename: string, text: string, type = "text/markdown") {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export const markdownFilename = (title: string) =>
  `${
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "page"
  }.md`;
