"use client";

import { textOf } from "@codechatter/workspace-model";
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { useRoom } from "@/components/room/room-context";

const remarkPlugins = [remarkGfm];

// Document-sized type for a README, not chat-sized.
const components: Components = {
  h1: ({ children }) => (
    <h1 className="mt-6 mb-3 border-b pb-2 text-2xl font-semibold tracking-tight first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-6 mb-2 border-b pb-1.5 text-xl font-semibold tracking-tight">{children}</h2>
  ),
  h3: ({ children }) => <h3 className="mt-5 mb-2 text-base font-semibold">{children}</h3>,
  p: ({ children }) => <p className="my-3 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-6">{children}</ol>,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-border pl-4 text-muted-foreground">{children}</blockquote>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline decoration-border underline-offset-4 hover:decoration-foreground"
    >
      {children}
    </a>
  ),
  code: ({ children, className }) =>
    className ? (
      <code className={`${className} font-mono text-[0.85em]`}>{children}</code>
    ) : (
      <code className="rounded-sm bg-muted px-1 py-px font-mono text-[0.85em]">{children}</code>
    ),
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-md border bg-chrome px-3 py-2 text-xs leading-relaxed">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border px-2 py-1 text-left font-medium">{children}</th>,
  td: ({ children }) => <td className="border px-2 py-1">{children}</td>,
  hr: () => <hr className="my-6 border-border" />,
  img: ({ src, alt }) =>
    typeof src === "string" ? (
      // eslint-disable-next-line @next/next/no-img-element -- images in someone's Markdown can come from anywhere
      <img src={src} alt={alt ?? ""} className="my-3 max-w-full rounded-md" />
    ) : null,
};

/** The file's live text: re-renders as anyone types. */
export function useFileText(fileId: string): string {
  const { doc } = useRoom();
  const version = useRef(0);
  const subscribe = useCallback(
    (onChange: () => void) => {
      const text = textOf(doc, fileId);
      if (!text) return () => {};
      const handler = () => {
        version.current += 1;
        onChange();
      };
      text.observe(handler);
      return () => text.unobserve(handler);
    },
    [doc, fileId],
  );
  const tick = useSyncExternalStore(
    subscribe,
    () => version.current,
    () => 0,
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the tick is the change
  return useMemo(() => textOf(doc, fileId)?.toString() ?? "", [doc, fileId, tick]);
}

/** A Markdown file, rendered with document-sized type (a README, not a chat message). */
export function MarkdownBody({ text }: { text: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <article className="mx-auto max-w-3xl px-8 py-6 text-sm">
        <Markdown remarkPlugins={remarkPlugins} components={components}>
          {text}
        </Markdown>
      </article>
    </div>
  );
}
