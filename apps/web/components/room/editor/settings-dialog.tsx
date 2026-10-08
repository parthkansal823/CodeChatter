"use client";

import { Minus, Plus } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import { FONT_SIZE, TAB_SIZES, type EditorSettings } from "./settings";
import { useEditorSettings, useSettingsValues } from "./settings-store";

type Option<T extends string> = readonly [value: T, label: string];

const LINE_NUMBER_OPTIONS: Option<EditorSettings["lineNumbers"]>[] = [["on", "On"], ["relative", "Relative"], ["off", "Off"]];
const WHITESPACE_OPTIONS: Option<EditorSettings["renderWhitespace"]>[] = [
  ["none", "Hidden"],
  ["selection", "In selection"],
  ["boundary", "Between words"],
  ["trailing", "Trailing"],
  ["all", "Always"],
];
const CURSOR_STYLE_OPTIONS: Option<EditorSettings["cursorStyle"]>[] = [
  ["line", "Line"],
  ["line-thin", "Thin line"],
  ["block", "Block"],
  ["block-outline", "Outlined block"],
  ["underline", "Underline"],
  ["underline-thin", "Thin underline"],
];
const CURSOR_BLINK_OPTIONS: Option<EditorSettings["cursorBlinking"]>[] = [
  ["smooth", "Smooth"],
  ["blink", "Blink"],
  ["phase", "Phase"],
  ["expand", "Expand"],
  ["solid", "Steady"],
];
const INDENT_OPTIONS: Option<"spaces" | "tabs">[] = [["spaces", "Spaces"], ["tabs", "Tabs"]];

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const s = useSettingsValues();
  const update = useEditorSettings((state) => state.update);
  const reset = useEditorSettings((state) => state.reset);
  const zoom = useEditorSettings((state) => state.zoom);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="text-base">Editor settings</DialogTitle>
          <DialogDescription>Saved in this browser for you only. Changes apply as you make them.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[62vh] overflow-y-auto px-5 py-3">
          <Section title="Text">
            <Row label="Font size" htmlFor="set-font-size" hint="Ctrl or Cmd with plus, minus or 0 in the editor">
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon-xs" aria-label="Smaller font" disabled={s.fontSize <= FONT_SIZE.min} onClick={() => zoom(-1)}>
                  <Minus />
                </Button>
                <output id="set-font-size" aria-label="Font size" className="w-10 text-center text-sm tabular-nums">
                  {s.fontSize}
                </output>
                <Button variant="outline" size="icon-xs" aria-label="Larger font" disabled={s.fontSize >= FONT_SIZE.max} onClick={() => zoom(1)}>
                  <Plus />
                </Button>
              </div>
            </Row>
            <Toggle id="set-ligatures" label="Font ligatures" hint="Draw pairs like => and != as one symbol" checked={s.fontLigatures} onChange={(v) => update({ fontLigatures: v })} />
          </Section>

          <Section title="Indentation">
            <Row label="Tab size" htmlFor="set-tab-size">
              <Choice
                id="set-tab-size"
                value={String(s.tabSize)}
                options={TAB_SIZES.map((n) => [String(n), `${n} columns`] as const)}
                onChange={(v) => update({ tabSize: Number(v) })}
              />
            </Row>
            <Row label="Indent with" htmlFor="set-indent">
              <Choice id="set-indent" value={s.insertSpaces ? "spaces" : "tabs"} options={INDENT_OPTIONS} onChange={(v) => update({ insertSpaces: v === "spaces" })} />
            </Row>
            <Toggle
              id="set-detect"
              label="Match each file"
              hint="Keep the indentation a file already uses instead of the two settings above"
              checked={s.detectIndentation}
              onChange={(v) => update({ detectIndentation: v })}
            />
          </Section>

          <Section title="Display">
            <Toggle id="set-wrap" label="Word wrap" checked={s.wordWrap} onChange={(v) => update({ wordWrap: v })} />
            <Toggle id="set-minimap" label="Minimap" hint="Also shows where everyone else is" checked={s.minimap} onChange={(v) => update({ minimap: v })} />
            <Row label="Line numbers" htmlFor="set-lines">
              <Choice id="set-lines" value={s.lineNumbers} options={LINE_NUMBER_OPTIONS} onChange={(v) => update({ lineNumbers: v })} />
            </Row>
            <Row label="Show whitespace" htmlFor="set-whitespace">
              <Choice id="set-whitespace" value={s.renderWhitespace} options={WHITESPACE_OPTIONS} onChange={(v) => update({ renderWhitespace: v })} />
            </Row>
            <Toggle id="set-sticky" label="Sticky scroll" hint="Pin the enclosing function or class at the top" checked={s.stickyScroll} onChange={(v) => update({ stickyScroll: v })} />
          </Section>

          <Section title="Cursor">
            <Row label="Cursor style" htmlFor="set-cursor-style">
              <Choice id="set-cursor-style" value={s.cursorStyle} options={CURSOR_STYLE_OPTIONS} onChange={(v) => update({ cursorStyle: v })} />
            </Row>
            <Row label="Cursor blinking" htmlFor="set-cursor-blink">
              <Choice id="set-cursor-blink" value={s.cursorBlinking} options={CURSOR_BLINK_OPTIONS} onChange={(v) => update({ cursorBlinking: v })} />
            </Row>
          </Section>

          <Section title="Brackets">
            <Toggle id="set-bracket-colors" label="Bracket pair colours" checked={s.bracketColors} onChange={(v) => update({ bracketColors: v })} />
            <Toggle id="set-bracket-guides" label="Bracket pair guides" checked={s.bracketGuides} onChange={(v) => update({ bracketGuides: v })} />
          </Section>

          <Section title="Formatting">
            <Toggle id="set-paste" label="Format on paste" checked={s.formatOnPaste} onChange={(v) => update({ formatOnPaste: v })} />
            <Toggle
              id="set-save"
              label="Format on save"
              hint="Ctrl or Cmd with S formats the file if its language has a formatter"
              checked={s.formatOnSave}
              onChange={(v) => update({ formatOnSave: v })}
            />
          </Section>
        </div>
        <DialogFooter className="border-t px-5 py-3 sm:justify-between">
          <Button variant="outline" size="sm" onClick={reset}>
            Reset to defaults
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="py-2" aria-label={title}>
      <h3 className="pb-1 text-xs font-medium text-muted-foreground">{title}</h3>
      <div className="divide-y">{children}</div>
    </section>
  );
}

function Row({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-6 py-1">
      <div className="min-w-0">
        <Label htmlFor={htmlFor} className="font-normal">
          {label}
        </Label>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ id, label, hint, checked, onChange }: { id: string; label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <Row label={label} hint={hint} htmlFor={id}>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </Row>
  );
}

function Choice<T extends string>({ id, value, options, onChange }: { id: string; value: T; options: readonly Option<T>[]; onChange: (value: T) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger id={id} size="sm" className="h-7 w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([optionValue, text]) => (
          <SelectItem key={optionValue} value={optionValue}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
