"use client";

import { Columns2, Maximize2, X } from "lucide-react";

import { Button } from "@/components/ui/button";

import { CsvTable } from "./csv-table";
import { MarkdownBody, useFileText } from "./markdown-preview";
import type { PreviewKind } from "./preview-kind";
import { revealInFile } from "./reveal";
import { SvgImage } from "./svg-image";
import type { FilePreviewMode } from "./ui-store";

type Props = {
  file: { id: string; name: string };
  kind: PreviewKind;
  mode: Exclude<FilePreviewMode, "off">;
  onMode: (mode: FilePreviewMode) => void;
};

/**
 * The open file's preview, live as people type: Markdown rendered, a CSV or TSV file as
 * a table, an SVG as an image. Beside the code (Ctrl+K V) or on its own (Ctrl+Shift+V).
 */
export function FilePreview({ file, kind, mode, onMode }: Props) {
  const text = useFileText(file.id);
  // A table row double-clicked: the code beside the table, at that row's line.
  const showLine = (line: number) => {
    onMode("side");
    revealInFile(file, { startLine: line, startColumn: 1, endLine: line, endColumn: 1 });
  };
  return (
    <section aria-label={`Preview of ${file.name}`} className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-8 shrink-0 items-center border-b bg-chrome pr-1 pl-3 text-xs text-muted-foreground">
        <span className="truncate">Preview: {file.name}</span>
        {mode === "side" ? (
          <Button variant="ghost" size="xs" className="ml-auto" title="Ctrl+Shift+V" onClick={() => onMode("full")}>
            <Maximize2 /> Preview only
          </Button>
        ) : (
          <Button variant="ghost" size="xs" className="ml-auto" title="Ctrl+K V" onClick={() => onMode("side")}>
            <Columns2 /> Show the code
          </Button>
        )}
        <Button variant="ghost" size="icon-xs" aria-label="Close the preview" onClick={() => onMode("off")}>
          <X />
        </Button>
      </div>
      {kind === "markdown" ? (
        <MarkdownBody text={text} />
      ) : kind === "table" ? (
        <CsvTable text={text} name={file.name} onShowLine={showLine} />
      ) : (
        <SvgImage text={text} name={file.name} />
      )}
    </section>
  );
}
