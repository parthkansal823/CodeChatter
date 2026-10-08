"use client";

import { useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Bold, Code, Italic, Link2, MessageSquarePlus, Strikethrough } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = { editor: Editor; onComment: () => void };

/** Formatting and Comment, floating over selected text. */
export function SelectionMenu({ editor, onComment }: Props) {
  const [linking, setLinking] = useState(false);
  const [url, setUrl] = useState("");
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({ bold: e.isActive("bold"), italic: e.isActive("italic"), strike: e.isActive("strike"), code: e.isActive("code"), link: e.isActive("link") }),
  });

  const apply = () => {
    const href = url.trim();
    if (href) editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    else editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setLinking(false);
  };
  const tools = [
    { id: "bold", label: "Bold", icon: Bold, on: active.bold, run: () => editor.chain().focus().toggleBold().run() },
    { id: "italic", label: "Italic", icon: Italic, on: active.italic, run: () => editor.chain().focus().toggleItalic().run() },
    { id: "strike", label: "Strikethrough", icon: Strikethrough, on: active.strike, run: () => editor.chain().focus().toggleStrike().run() },
    { id: "code", label: "Code", icon: Code, on: active.code, run: () => editor.chain().focus().toggleCode().run() },
  ];

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: "top", offset: 8, onHide: () => setLinking(false) }}
      shouldShow={({ editor: e, state }) => e.isEditable && !state.selection.empty && !e.isActive("codeBlock")}
    >
      <div role="toolbar" aria-label="Text formatting" className="z-popover flex items-center gap-0.5 rounded-md border bg-popover p-0.5 text-popover-foreground shadow-md">
        {linking ? (
          <form
            className="flex items-center gap-1 p-0.5"
            onSubmit={(e) => {
              e.preventDefault();
              apply();
            }}
          >
            <input
              autoFocus
              aria-label="Link address"
              value={url}
              placeholder="Paste a link, or leave empty to remove"
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setLinking(false)}
              className="h-6 w-56 rounded-sm border bg-background px-1.5 text-sm outline-none focus-visible:border-ring"
            />
            <Button type="submit" size="xs">
              Apply
            </Button>
          </form>
        ) : (
          <>
            {tools.map(({ id, label, icon: Icon, on, run }) => (
              <Button key={id} variant="ghost" size="icon-xs" aria-label={label} aria-pressed={on} className={cn(on && "bg-accent text-foreground")} onClick={run}>
                <Icon />
              </Button>
            ))}
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Link"
              aria-pressed={active.link}
              className={cn(active.link && "bg-accent text-foreground")}
              onClick={() => {
                setUrl((editor.getAttributes("link").href as string | undefined) ?? "");
                setLinking(true);
              }}
            >
              <Link2 />
            </Button>
            <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
            <Button variant="ghost" size="xs" onClick={onComment}>
              <MessageSquarePlus /> Comment
            </Button>
          </>
        )}
      </div>
    </BubbleMenu>
  );
}
