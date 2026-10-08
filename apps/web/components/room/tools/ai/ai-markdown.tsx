"use client";

import { Check, Copy, FileDiff } from "lucide-react";
import { createContext, use, useState } from "react";
import Markdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

type HastNode = { type: string; tagName?: string; value?: string; properties?: { className?: unknown }; children?: HastNode[] };

function hastText(node: HastNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(hastText).join("");
}

type Apply = {
  /** Replace the open file with a code block's content; absent when it can't be applied. */
  onApply?: (code: string) => void;
  /** Why Apply is unavailable, shown on the disabled button. */
  applyBlocked: string | null;
};

// Code blocks read Apply from context so the Markdown components can be
// defined once: components created per render would remount every block
// on each streamed word.
const ApplyContext = createContext<Apply>({ applyBlocked: null });

const components: Components = {
  pre: ({ node }: ExtraProps) => {
    const code = (node as HastNode | undefined)?.children?.find((child) => child.tagName === "code");
    const classes = code?.properties?.className;
    const language = (Array.isArray(classes) ? classes : []).map(String).find((c) => c.startsWith("language-"))?.slice(9) ?? "";
    return <CodeBlock language={language} code={hastText(code).replace(/\n$/, "")} />;
  },
  code: ({ children }) => <code className="rounded-sm bg-muted px-1 py-px font-mono text-[0.85em]">{children}</code>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline decoration-border underline-offset-4 hover:decoration-foreground">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
};

const remarkPlugins = [remarkGfm];

/** An AI answer: GitHub-flavoured Markdown in the AI face, code blocks with Copy and Apply. */
export function AiMarkdown({ text, onApply, applyBlocked }: Apply & { text: string }) {
  return (
    <div
      className={cn(
        "font-ai text-sm leading-relaxed break-words",
        "[&_p]:my-2 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5",
        "[&_h1]:mt-3 [&_h1]:mb-1.5 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1.5 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-2.5 [&_h3]:mb-1 [&_h3]:font-semibold",
        "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-2.5 [&_blockquote]:text-muted-foreground [&_hr]:my-3",
        "[&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium",
      )}
    >
      <ApplyContext value={{ ...(onApply && { onApply }), applyBlocked }}>
        <Markdown remarkPlugins={remarkPlugins} components={components}>
          {text}
        </Markdown>
      </ApplyContext>
    </div>
  );
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const { onApply, applyBlocked } = use(ApplyContext);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!(await copyText(code))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="my-2 overflow-hidden rounded-md border bg-background font-sans">
      <div className="flex h-7 items-center gap-0.5 border-b bg-chrome pr-1 pl-2.5">
        <span className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground">{language || "text"}</span>
        <Button size="xs" variant="ghost" onClick={() => void copy()} aria-label={copied ? "Copied" : "Copy code"}>
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy"}
        </Button>
        {onApply && (
          // A wrapper carries the reason: disabled buttons don't show a title.
          <span title={applyBlocked ?? "Replace the open file with this code"}>
            <Button size="xs" variant="ghost" disabled={Boolean(applyBlocked)} onClick={() => onApply(code)}>
              <FileDiff /> Apply to file
            </Button>
          </span>
        )}
      </div>
      <pre className="overflow-x-auto px-3 py-2 font-mono text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}
