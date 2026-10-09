"use client";

import { Download } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import type { Editor } from "./editor";
import { exportDrawings, pixelSize, runExport, topFrames, type ExportFormat, type ExportOptions } from "./export-actions";
import { useEditor } from "./hooks";

const FORMATS: Array<{ id: ExportFormat; label: string }> = [
  { id: "png", label: "PNG" },
  { id: "jpeg", label: "JPEG" },
  { id: "svg", label: "SVG" },
  { id: "pdf", label: "PDF" },
];

/** Fresh choices each time the dialog opens: what's selected right now decides what to export. */
function defaults(editor: Editor, name: string): ExportOptions {
  const board = editor.kind === "board";
  return {
    name,
    format: "png",
    scope: editor.topSelection().length > 0 ? "selection" : "all",
    scale: 2,
    border: board ? 24 : 0,
    background: board ? "canvas" : "transparent",
    grid: false,
    paper: "fit",
    landscape: true,
  };
}

/** The Export button. Like draw.io, it asks first: file name, format, what to include, size, border, background, grid and paper. */
export function ExportDialog({ name }: { name: string }) {
  const editor = useEditor();
  const [options, setOptions] = useState<ExportOptions | null>(null);
  return (
    <Dialog open={options !== null} onOpenChange={(open) => setOptions(open ? defaults(editor, name) : null)}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Download /> Export
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {options && <ExportForm options={options} onChange={setOptions} onDone={() => setOptions(null)} />}
      </DialogContent>
    </Dialog>
  );
}

function ExportForm({ options, onChange, onDone }: { options: ExportOptions; onChange: (next: ExportOptions) => void; onDone: () => void }) {
  const editor = useEditor();
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<ExportOptions>) => onChange({ ...options, ...patch });
  const selected = editor.topSelection().length;
  const frames = topFrames(editor).length;
  const pdf = options.format === "pdf";
  const transparentOk = options.format === "png" || options.format === "svg";
  const drawings = useMemo(() => exportDrawings(editor, options), [editor, options]);

  // Switching format keeps the other choices valid: only PDF has pages, JPEG and PDF can't be transparent.
  const setFormat = (format: ExportFormat) => {
    const patch: Partial<ExportOptions> = { format };
    if (format !== "pdf" && options.scope === "frames") patch.scope = "all";
    if ((format === "jpeg" || format === "pdf") && options.background === "transparent") patch.background = "white";
    set(patch);
  };

  const summary = (() => {
    const [first] = drawings;
    if (!first) return "Nothing to export yet.";
    if (options.format === "svg") return `SVG, ${Math.round(first.width)} × ${Math.round(first.height)}`;
    if (!pdf) {
      const { width, height } = pixelSize(first, options.scale);
      return `${options.format.toUpperCase()}, ${width.toLocaleString()} × ${height.toLocaleString()} px`;
    }
    const pages = `${drawings.length} ${drawings.length === 1 ? "page" : "pages"}`;
    return options.paper === "fit" ? `PDF, ${pages} sized to the drawing` : `PDF, ${pages}, ${options.paper === "a4" ? "A4" : "Letter"} ${options.landscape ? "landscape" : "portrait"}`;
  })();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const done = await runExport(editor, { ...options, name: options.name.trim() || "export" });
    setBusy(false);
    if (done) onDone();
  };

  return (
    <form onSubmit={(e) => void submit(e)}>
      <DialogHeader>
        <DialogTitle>Export</DialogTitle>
        <DialogDescription>Choose what to make, then download it.</DialogDescription>
      </DialogHeader>

      <div className="mt-4 grid grid-cols-[6.5rem_1fr] items-center gap-x-3 gap-y-3 text-sm">
        <Label htmlFor="export-name">File name</Label>
        <div className="flex items-center gap-1.5">
          <Input id="export-name" value={options.name} onChange={(e) => set({ name: e.target.value })} className="h-8" />
          <span className="text-muted-foreground">.{options.format === "jpeg" ? "jpg" : options.format}</span>
        </div>

        <span id="export-format">Format</span>
        <ToggleGroup type="single" variant="outline" size="sm" aria-labelledby="export-format" value={options.format} onValueChange={(v) => v && setFormat(v as ExportFormat)}>
          {FORMATS.map((f) => (
            <ToggleGroupItem key={f.id} value={f.id} className="px-3">
              {f.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <span id="export-scope" className="self-start pt-0.5">
          Include
        </span>
        <RadioGroup aria-labelledby="export-scope" value={options.scope} onValueChange={(v) => set({ scope: v as ExportOptions["scope"] })} className="gap-1.5">
          <Choice value="all" label="Everything" />
          <Choice value="selection" label={selected ? `The selection (${selected})` : "The selection (nothing selected)"} disabled={!selected} />
          {pdf && frames > 0 && <Choice value="frames" label={`Each frame as a page (${frames})`} />}
        </RadioGroup>

        {options.format !== "svg" && (
          <>
            <Label htmlFor="export-scale">{pdf ? "Sharpness" : "Size"}</Label>
            <Select value={String(options.scale)} onValueChange={(v) => set({ scale: Number(v) })}>
              <SelectTrigger id="export-scale" size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}x
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}

        <Label htmlFor="export-border">Border</Label>
        <div className="flex items-center gap-1.5">
          <Input
            id="export-border"
            type="number"
            min={0}
            max={400}
            step={4}
            value={options.border}
            onChange={(e) => set({ border: Math.max(0, Math.min(400, Number(e.target.value) || 0)) })}
            className="h-8 w-20"
          />
          <span className="text-muted-foreground">px around the drawing</span>
        </div>

        <span id="export-background" className="self-start pt-0.5">
          Background
        </span>
        <RadioGroup aria-labelledby="export-background" value={options.background} onValueChange={(v) => set({ background: v as ExportOptions["background"] })} className="gap-1.5">
          {transparentOk && <Choice value="transparent" label="Transparent" />}
          <Choice value="canvas" label="Canvas colour" />
          <Choice value="white" label="White" />
        </RadioGroup>

        <span />
        <label className="flex items-center gap-2">
          <Checkbox checked={options.grid} onCheckedChange={(checked) => set({ grid: checked === true })} />
          Include the grid
        </label>

        {pdf && (
          <>
            <Label htmlFor="export-paper">Page</Label>
            <Select value={options.paper} onValueChange={(v) => set({ paper: v as ExportOptions["paper"] })}>
              <SelectTrigger id="export-paper" size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fit">Fit to the drawing</SelectItem>
                <SelectItem value="a4">A4</SelectItem>
                <SelectItem value="letter">Letter</SelectItem>
              </SelectContent>
            </Select>
            {options.paper !== "fit" && (
              <>
                <span id="export-orientation">Orientation</span>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  aria-labelledby="export-orientation"
                  value={options.landscape ? "landscape" : "portrait"}
                  onValueChange={(v) => v && set({ landscape: v === "landscape" })}
                >
                  <ToggleGroupItem value="portrait" className="px-3">
                    Portrait
                  </ToggleGroupItem>
                  <ToggleGroupItem value="landscape" className="px-3">
                    Landscape
                  </ToggleGroupItem>
                </ToggleGroup>
              </>
            )}
          </>
        )}
      </div>

      <p role="status" className="mt-4 text-xs text-muted-foreground">
        {summary}
      </p>
      <DialogFooter className="mt-3">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={busy || drawings.length === 0}>
          <Download /> {busy ? "Exporting…" : "Export"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function Choice({ value, label, disabled = false }: { value: string; label: string; disabled?: boolean }) {
  const id = `export-${value}`;
  return (
    <div className="flex items-center gap-2">
      <RadioGroupItem id={id} value={value} disabled={disabled} />
      <Label htmlFor={id} className={disabled ? "font-normal text-muted-foreground" : "font-normal"}>
        {label}
      </Label>
    </div>
  );
}
