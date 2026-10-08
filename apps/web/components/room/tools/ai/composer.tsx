"use client";

import { ArrowUp, FileCode2, FolderTree, ImagePlus, Square, SquareTerminal, TextSelect, X, type LucideIcon } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { AiAttach } from "./ai-requests";
import { imageFromClipboard, prepareImage, type PastedImage } from "./image";
import { SUMMARY_WINDOWS } from "./modes";

type Props = {
  draft: string;
  onDraft: (draft: string) => void;
  placeholder: string;
  attach: AiAttach;
  onAttach: (attach: AiAttach) => void;
  /** What can be attached right now. */
  available: { fileName: string | null; selection: { startLine: number; endLine: number } | null; hasRun: boolean; fileCount: number };
  image: PastedImage | null;
  onImage: (image: PastedImage | null) => void;
  vision: boolean;
  busy: boolean;
  canChat: boolean;
  canSend: boolean;
  onSend: () => void;
  onStop: () => void;
  /** Summary mode picks a time window instead of context chips. */
  summaryWindow?: { minutes: number; onChange: (minutes: number) => void };
};

/** The message box with its context chips, image paste and Send / Stop. */
export function Composer(props: Props) {
  const { attach, available, image, busy } = props;
  const fileInput = useRef<HTMLInputElement>(null);
  const toggle = (key: keyof AiAttach) => props.onAttach({ ...attach, [key]: !attach[key] });

  const addImage = async (file: Blob) => {
    if (!props.vision) return void toast.error("This AI model can't read images. Describe it in words instead.");
    try {
      const prepared = await prepareImage(file);
      if (prepared) props.onImage(prepared);
      else toast.error("That image is too large, even when shrunk. Try a smaller screenshot.");
    } catch {
      toast.error("Couldn't read that image. Try a PNG or JPEG.");
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (props.canSend) props.onSend();
      }}
      className="border-t p-2"
    >
      {props.summaryWindow ? (
        <div className="mb-1.5 flex items-center gap-1.5">
          <span className="text-2xs text-muted-foreground">Look back</span>
          <Select value={String(props.summaryWindow.minutes)} onValueChange={(value) => props.summaryWindow!.onChange(Number(value))}>
            <SelectTrigger size="sm" aria-label="How far back to summarise" className="data-[size=sm]:h-6 gap-1 px-2 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              {SUMMARY_WINDOWS.map(([minutes, label]) => (
                <SelectItem key={minutes} value={String(minutes)}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
      <div className="mb-1.5 flex flex-wrap items-center gap-1" role="group" aria-label="Context to include">
        <span className="mr-0.5 text-2xs text-muted-foreground">Include</span>
        {available.fileName && (
          <Chip icon={FileCode2} pressed={attach.file} onClick={() => toggle("file")} title="The open file">
            {available.fileName}
          </Chip>
        )}
        {available.selection && (
          <Chip icon={TextSelect} pressed={attach.selection} onClick={() => toggle("selection")} title="Your selection in the editor">
            {available.selection.startLine === available.selection.endLine
              ? `Line ${available.selection.startLine}`
              : `Lines ${available.selection.startLine}-${available.selection.endLine}`}
          </Chip>
        )}
        <Chip
          icon={SquareTerminal}
          pressed={attach.run}
          onClick={() => toggle("run")}
          title={available.hasRun ? "The output of the room's last run" : "Nobody has run code in this room yet"}
        >
          Run output
        </Chip>
        <Chip icon={FolderTree} pressed={attach.paths} onClick={() => toggle("paths")} title="The names of every file in the room">
          File list ({available.fileCount})
        </Chip>
      </div>
      )}

      {image && (
        <div className="mb-1.5 flex items-center gap-2 rounded-md border bg-background p-1 pr-1">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local data: URL; next/image can't optimise it */}
          <img src={image.url} alt="Attached image" className="size-8 rounded-sm border object-cover" />
          <span className="flex-1 text-xs text-muted-foreground">Image attached</span>
          <Button type="button" size="icon-xs" variant="ghost" aria-label="Remove image" onClick={() => props.onImage(null)}>
            <X />
          </Button>
        </div>
      )}

      <div className="flex items-end gap-1 rounded-md border bg-background p-1.5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
        <textarea
          value={props.draft}
          onChange={(e) => props.onDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (props.canSend) props.onSend();
            } else if (e.key === "Escape" && busy) {
              e.preventDefault();
              props.onStop();
            }
          }}
          onPaste={(e) => {
            const file = imageFromClipboard(e);
            if (!file) return;
            e.preventDefault();
            void addImage(file);
          }}
          disabled={!props.canChat}
          rows={1}
          placeholder={props.canChat ? props.placeholder : "You can't use the AI in this room."}
          aria-label="Message to the AI"
          className="max-h-40 min-h-7 flex-1 resize-none bg-transparent px-1.5 py-1 text-sm outline-none placeholder:text-muted-foreground [field-sizing:content]"
        />
        {props.vision && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" size="icon-sm" variant="ghost" aria-label="Attach an image" onClick={() => fileInput.current?.click()} disabled={!props.canChat}>
                  <ImagePlus />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Attach an image (or paste one)</TooltipContent>
            </Tooltip>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void addImage(file);
              }}
            />
          </>
        )}
        {busy ? (
          <Button type="button" size="sm" variant="outline" onClick={props.onStop} aria-label="Stop generating">
            <Square className="size-3 fill-current" /> Stop
          </Button>
        ) : (
          <Button type="submit" size="icon-sm" disabled={!props.canSend} aria-label="Send to the AI">
            <ArrowUp />
          </Button>
        )}
      </div>
    </form>
  );
}

function Chip({ icon: Icon, pressed, onClick, title, children }: { icon: LucideIcon; pressed: boolean; onClick: () => void; title: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      title={title}
      className={cn(
        "inline-flex h-6 max-w-44 items-center gap-1 rounded-sm border px-1.5 text-xs transition-colors",
        pressed ? "border-foreground/25 bg-background text-foreground" : "border-dashed text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-3 shrink-0" />
      <span className="truncate">{children}</span>
    </button>
  );
}
