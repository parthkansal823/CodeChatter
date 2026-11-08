/** Keep app appearance and the editor's existing account preferences together, using the room's own stores and save path. */
"use client";

import { Check, ChevronDown, Monitor, Moon, Sun } from "lucide-react";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { useTheme } from "next-themes";

import { CURSOR_BLINKING, CURSOR_STYLES, FONT_SIZE, LINE_NUMBERS, WHITESPACE, type EditorSettings } from "@/components/room/editor/settings";
import { useSettingsSync } from "@/components/room/editor/settings-sync";
import { useEditorSettings, useSettingsValues } from "@/components/room/editor/settings-store";
import { BUILT_IN_THEMES, useImportedThemes } from "@/components/room/editor/themes";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";

const subscribeToHydration = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

const APP_THEMES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "Match my device", icon: Monitor },
] as const;

type ToggleKey = { [K in keyof EditorSettings]: EditorSettings[K] extends boolean ? K : never }[keyof EditorSettings];

const TOGGLES: ReadonlyArray<{ key: ToggleKey; label: string; hint?: string }> = [
  { key: "fontLigatures", label: "Font ligatures", hint: "Draw pairs like => and != as one symbol." },
  { key: "detectIndentation", label: "Match file indentation", hint: "Follow each file's indentation instead of the tab settings above." },
  { key: "wordWrap", label: "Word wrap" },
  { key: "minimap", label: "Minimap" },
  { key: "stickyScroll", label: "Sticky scroll", hint: "Keep the enclosing function or class at the top." },
  { key: "breadcrumbs", label: "Breadcrumbs" },
  { key: "bracketColors", label: "Bracket pair colors" },
  { key: "bracketGuides", label: "Bracket pair guides" },
  { key: "formatOnPaste", label: "Format on paste" },
  { key: "formatOnSave", label: "Format on save", hint: "Uses the file's formatter when one is available." },
  { key: "aiCompletions", label: "AI suggestions as you type", hint: "Requires AI to be set up for the room." },
];

const LINE_LABELS = { on: "On", relative: "Relative", off: "Off" };
const WHITESPACE_LABELS = { none: "Hidden", selection: "In selection", boundary: "Between words", trailing: "Trailing", all: "Always" };
const CURSOR_LABELS = { line: "Line", "line-thin": "Thin line", block: "Block", "block-outline": "Outlined block", underline: "Underline", "underline-thin": "Thin underline" };
const BLINK_LABELS = { smooth: "Smooth", blink: "Blink", phase: "Phase", expand: "Expand", solid: "Steady" };

export function Appearance() {
  const ready = useSyncExternalStore(subscribeToHydration, clientReady, serverReady);
  const { theme, setTheme } = useTheme();

  return (
    <section aria-labelledby="preferences-appearance" className="grid gap-4">
      <div className="grid gap-1">
        <h2 id="preferences-appearance" className="font-medium">Appearance</h2>
        <p className="text-muted-foreground">Choose the app theme. It applies as soon as you choose it.</p>
      </div>
      <RadioGroup aria-label="App theme" value={ready ? theme ?? "system" : ""} onValueChange={setTheme} disabled={!ready} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {APP_THEMES.map(({ value, label, icon: Icon }) => {
          const selected = ready && (theme ?? "system") === value;
          return (
            <label key={value} htmlFor={`preferences-theme-${value}`} className="grid cursor-pointer gap-3 rounded-md border bg-card p-3 has-data-[state=checked]:border-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
              <ThemePreview mode={value} />
              <span className="flex items-center gap-2">
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="flex-1">{label}</span>
                {selected && <Check className="size-3.5" aria-hidden="true" />}
                <RadioGroupItem id={`preferences-theme-${value}`} value={value} aria-label={label} />
              </span>
            </label>
          );
        })}
      </RadioGroup>
      {ready ? <EditorPreferences /> : <p role="status" className="text-muted-foreground">Loading editor preferences...</p>}
    </section>
  );
}

/** Decorative light and dark samples use the existing neutral tokens in either app theme. */
function ThemePreview({ mode }: { mode: "light" | "dark" | "system" }) {
  return (
    <span aria-hidden="true" className="flex h-16 overflow-hidden rounded border border-input">
      {mode !== "dark" && <PreviewHalf dark={false} />}
      {mode !== "light" && <PreviewHalf dark />}
    </span>
  );
}

function PreviewHalf({ dark }: { dark: boolean }) {
  return (
    <span className={dark ? "flex min-w-0 flex-1 gap-2 bg-foreground p-2 dark:bg-background" : "flex min-w-0 flex-1 gap-2 bg-background p-2 dark:bg-foreground"}>
      <span className={dark ? "w-3 rounded-sm bg-background/20 dark:bg-foreground/20" : "w-3 rounded-sm bg-foreground/15 dark:bg-background/15"} />
      <span className="flex flex-1 flex-col gap-1.5 pt-1">
        <span className="h-1 w-3/4 rounded bg-brand" />
        <span className={dark ? "h-1 w-full rounded bg-background/50 dark:bg-foreground/50" : "h-1 w-full rounded bg-foreground/50 dark:bg-background/50"} />
        <span className={dark ? "h-1 w-2/3 rounded bg-background/30 dark:bg-foreground/30" : "h-1 w-2/3 rounded bg-foreground/30 dark:bg-background/30"} />
      </span>
    </span>
  );
}

function EditorPreferences() {
  useSettingsSync();
  const settings = useSettingsValues();
  const update = useEditorSettings((state) => state.update);
  const imported = useImportedThemes((state) => state.themes);
  const themes = [...BUILT_IN_THEMES, ...imported.map(({ id, name }) => [id, name] as const)];
  const editorTheme = themes.some(([id]) => id === settings.editorTheme) ? settings.editorTheme : "auto";

  return (
    <div className="mt-2 grid gap-3 border-t pt-4">
      <div className="grid gap-1">
        <h3 className="font-medium">Editor preferences</h3>
        <p className="text-muted-foreground">These use the same settings as the room editor. Changes stay in this browser and save to your account after a short pause when the server is reachable.</p>
      </div>
      <div className="grid gap-x-8 sm:grid-cols-2">
        <SettingRow label="Editor theme" id="preferences-editor-theme">
          <Choice id="preferences-editor-theme" value={editorTheme} options={themes} onChange={(value) => update({ editorTheme: value })} />
        </SettingRow>
        <SettingRow label="Font size" id="preferences-font-size">
          <FontSize value={settings.fontSize} onChange={(fontSize) => update({ fontSize })} />
        </SettingRow>
        <SettingRow label="Tab size" id="preferences-tab-size">
          <Choice id="preferences-tab-size" value={String(settings.tabSize)} options={Array.from({ length: 8 }, (_, index) => [String(index + 1), `${index + 1} columns`] as const)} onChange={(value) => update({ tabSize: Number(value) })} />
        </SettingRow>
        <SettingRow label="Indent with" id="preferences-indent">
          <Choice id="preferences-indent" value={settings.insertSpaces ? "spaces" : "tabs"} options={[["spaces", "Spaces"], ["tabs", "Tabs"]]} onChange={(value) => update({ insertSpaces: value === "spaces" })} />
        </SettingRow>
        <SettingRow label="Line numbers" id="preferences-line-numbers">
          <Choice id="preferences-line-numbers" value={settings.lineNumbers} options={LINE_NUMBERS.map((value) => [value, LINE_LABELS[value]])} onChange={(value) => update({ lineNumbers: value })} />
        </SettingRow>
        <SettingRow label="Show whitespace" id="preferences-whitespace">
          <Choice id="preferences-whitespace" value={settings.renderWhitespace} options={WHITESPACE.map((value) => [value, WHITESPACE_LABELS[value]])} onChange={(value) => update({ renderWhitespace: value })} />
        </SettingRow>
        <SettingRow label="Cursor style" id="preferences-cursor-style">
          <Choice id="preferences-cursor-style" value={settings.cursorStyle} options={CURSOR_STYLES.map((value) => [value, CURSOR_LABELS[value]])} onChange={(value) => update({ cursorStyle: value })} />
        </SettingRow>
        <SettingRow label="Cursor blinking" id="preferences-cursor-blinking">
          <Choice id="preferences-cursor-blinking" value={settings.cursorBlinking} options={CURSOR_BLINKING.map((value) => [value, BLINK_LABELS[value]])} onChange={(value) => update({ cursorBlinking: value })} />
        </SettingRow>
        <SettingRow label="Key bindings" id="preferences-keymap">
          <Choice id="preferences-keymap" value={settings.keymap} options={[["standard", "Standard"], ["vim", "Vim"]]} onChange={(value) => update({ keymap: value })} />
        </SettingRow>
        {TOGGLES.map(({ key, label, hint }) => (
          <SettingRow key={key} label={label} id={`preferences-${key}`} hint={hint}>
            <Switch id={`preferences-${key}`} checked={settings[key]} onCheckedChange={(checked) => update({ [key]: checked })} aria-describedby={hint ? `preferences-${key}-hint` : undefined} />
          </SettingRow>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Import themes and change individual keyboard shortcuts from the editor settings in a room.</p>
    </div>
  );
}

/** Keep incomplete typing editable; the shared store still validates every completed size. */
function FontSize({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  return (
    <Input
      id="preferences-font-size"
      type="number"
      min={FONT_SIZE.min}
      max={FONT_SIZE.max}
      step={1}
      value={editing ? draft : value}
      className="h-8 w-24 text-sm"
      onFocus={() => { setDraft(String(value)); setEditing(true); }}
      onChange={(event) => {
        setDraft(event.target.value);
        const next = event.target.valueAsNumber;
        if (Number.isFinite(next) && next >= FONT_SIZE.min && next <= FONT_SIZE.max) onChange(next);
      }}
      onBlur={() => {
        const next = Number(draft);
        if (draft.trim() && Number.isFinite(next)) onChange(next);
        setEditing(false);
      }}
      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
    />
  );
}

function SettingRow({ label, id, hint, children }: { label: string; id: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 min-w-0 items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <Label htmlFor={id} className="font-normal">{label}</Label>
        {hint && <p id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Choice<T extends string>({ id, value, options, onChange }: { id: string; value: T; options: ReadonlyArray<readonly [T, string]>; onChange: (value: T) => void }) {
  return (
    <span className="relative block w-36 shrink-0">
      <select id={id} value={value} onChange={(event) => onChange(event.target.value as T)} title={options.find(([option]) => option === value)?.[1]} className="h-8 w-full appearance-none rounded-md border border-input bg-background px-2 pr-7 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50">
        {options.map(([option, label]) => <option key={option} value={option}>{label}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
    </span>
  );
}
