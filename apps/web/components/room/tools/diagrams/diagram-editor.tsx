"use client";

import { roomDocName } from "@codechatter/workspace-model";
import { Download, Eye } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { cssVar } from "@/lib/css-color";

import { CanvasHeader, NameField } from "../canvas/chrome";
import { fileName } from "../canvas/export-actions";
import { renameItem, type ListItem } from "../canvas/list";
import { useLiveDoc, type LiveDoc } from "../canvas/live-doc";
import { onRemotePatches, onRemoteXml, pushPatch, readXml, saveXml } from "./drawio-sync";

/** draw.io itself. Self-host it (docker run -p 8085:8080 jgraph/drawio) and set this to keep diagrams off diagrams.net. */
const DRAWIO_URL = process.env.NEXT_PUBLIC_DRAWIO_URL || "https://embed.diagrams.net";
const DRAWIO_ORIGIN = new URL(DRAWIO_URL).origin;
// Each change's patch goes out at once; the whole diagram (what newcomers load) is saved at most this often.
const SAVE_EVERY_MS = 2_000;

// draw.io's own export dialogs: every option it asks (size, border, transparency, pages, paper…).
const EXPORTS = [
  { label: "PNG…", action: "exportPng" },
  { label: "JPEG…", action: "exportJpg" },
  { label: "SVG…", action: "exportSvg" },
  { label: "PDF…", action: "exportPdf" },
  { label: "HTML…", action: "exportHtml" },
] as const;

type Props = {
  roomId: string;
  item: ListItem;
  list: LiveDoc;
  editable: boolean;
  onBack: () => void;
  onClose: () => void;
};

type DrawioMessage = { event?: string; xml?: string; patch?: unknown; href?: string };

/**
 * A new diagram's first state. Everyone must start from the same page id:
 * draw.io's patches name their page, and a blank load gets a random one.
 */
const blankDiagram = (id: string) =>
  `<mxfile><diagram id="${id}" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>`;

/** draw.io in the app's colours and type: the frame can't see the page's CSS variables, so they go in resolved. */
function drawioConfig() {
  const [ink, paper, line, muted, chrome, brand] = ["--foreground", "--background", "--border", "--muted-foreground", "--chrome", "--brand"].map((name) =>
    cssVar(name).slice(0, 7),
  ) as [string, string, string, string, string, string];
  const font = "'Mona Sans', 'Segoe UI', system-ui, -apple-system, sans-serif";
  return {
    compressXml: true,
    // Diagram text uses fonts every viewer has; the app's own font isn't loaded inside the frame.
    defaultFonts: ["Helvetica", "Verdana", "Courier New", "Georgia", "Garamond"],
    presetColors: [ink, paper, brand, muted, line].map((hex) => hex.slice(1)),
    defaultVertexStyle: { strokeColor: ink, fillColor: paper, fontColor: ink, fontFamily: "Helvetica", rounded: "1", arcSize: "10" },
    defaultEdgeStyle: { strokeColor: ink, fontColor: ink, edgeStyle: "orthogonalEdgeStyle", rounded: "1", endArrow: "block", endFill: "1" },
    css: [
      `.geEditor, .geEditor input, .geEditor button, .geEditor select, .geDialog, .geDialog * { font-family: ${font} !important; }`,
      `.geEditor { background: ${paper} !important; }`,
      `.geMenubarContainer, .geToolbarContainer, .geFooterContainer, .geTabContainer, .geSidebarContainer, .geFormatContainer { background: ${chrome} !important; border-color: ${line} !important; }`,
      `.geBtn.gePrimaryBtn, .gePrimaryBtn { background: ${brand} !important; border-color: ${brand} !important; color: black !important; }`,
      `.geTabContainer .geActiveTab { box-shadow: inset 0 2px 0 ${brand} !important; }`,
    ].join("\n"),
  };
}

/** One diagram: draw.io with every one of its features, saved in the room and edited by everyone at once. */
export function DiagramEditor({ roomId, item, list, editable, onBack, onClose }: Props) {
  const live = useLiveDoc(roomDocName(roomId, "diagram", item.id));
  const frame = useRef<HTMLIFrameElement>(null);
  const { resolvedTheme } = useTheme();
  const [loaded, setLoaded] = useState(false);

  // Viewers get draw.io without its editing chrome. A theme change reloads the frame in the new theme.
  const src = useMemo(() => {
    const params = new URLSearchParams({ embed: "1", proto: "json", configure: "1", spin: "1", ui: "simple", libraries: "1", noSaveBtn: "1", noExitBtn: "1", saveAndExit: "0", lang: "en" });
    if (resolvedTheme === "dark") params.set("dark", "1");
    if (!editable) params.set("chrome", "0");
    return `${DRAWIO_URL}/?${params}`;
  }, [resolvedTheme, editable]);

  useEffect(() => {
    if (!live?.synced) return;
    const doc = live.doc;
    const target = () => frame.current?.contentWindow ?? null;
    const post = (message: object) => target()?.postMessage(JSON.stringify(message), DRAWIO_ORIGIN);
    let ready = false;
    let loadedXml = "";
    let early: unknown[] = [];
    let pendingXml: string | null = null;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      saveTimer = undefined;
      if (pendingXml !== null) saveXml(doc, pendingXml);
      pendingXml = null;
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== DRAWIO_ORIGIN || event.source !== target()) return;
      let message: DrawioMessage;
      try {
        message = JSON.parse(String(event.data)) as DrawioMessage;
      } catch {
        return;
      }
      switch (message.event) {
        case "configure":
          post({ action: "configure", config: drawioConfig() });
          return;
        case "init":
          loadedXml = readXml(doc) || blankDiagram(item.id);
          post({ action: "load", xml: loadedXml, autosave: 1, diffSync: editable, title: item.name });
          return;
        case "load": {
          ready = true;
          setLoaded(true);
          // What others did while the frame was loading: their patches, then anything saved since.
          const missed = early;
          early = [];
          if (editable) missed.forEach((patch) => post({ action: "patch", patch }));
          const latest = readXml(doc);
          if (latest && latest !== loadedXml) post({ action: "merge", xml: latest });
          return;
        }
        case "autosave":
          if (!editable) return;
          if (message.patch) pushPatch(doc, message.patch);
          if (typeof message.xml === "string") {
            pendingXml = message.xml;
            saveTimer ??= setTimeout(flush, SAVE_EVERY_MS);
          }
          return;
        case "openLink":
          if (message.href) window.open(message.href, "_blank", "noopener,noreferrer");
          return;
      }
    };

    window.addEventListener("message", onMessage);
    const stopPatches = onRemotePatches(doc, (patch) => {
      if (!editable) return;
      if (ready) post({ action: "patch", patch });
      else early.push(patch);
    });
    // Viewers have no patch log of their own: they follow the saved diagram.
    const stopXml = onRemoteXml(doc, (xml) => !editable && ready && post({ action: "merge", xml }));
    return () => {
      window.removeEventListener("message", onMessage);
      stopPatches();
      stopXml();
      clearTimeout(saveTimer);
      flush();
    };
  }, [live, editable, item.id, item.name, src]);

  const invoke = (action: string) => frame.current?.contentWindow?.postMessage(JSON.stringify({ action: "invokeAction", actionName: action }), DRAWIO_ORIGIN);
  const downloadFile = () => {
    if (!live) return;
    const url = URL.createObjectURL(new Blob([readXml(live.doc)], { type: "application/xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName(item.name)}.drawio`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <CanvasHeader
        backLabel="Diagrams"
        onBack={onBack}
        onClose={onClose}
        name={<NameField name={item.name} editable={editable} label="diagram" onRename={(name) => renameItem(list.doc, item.id, name)} />}
        actions={
          <>
            {!editable && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Eye className="size-3.5" /> View only
              </span>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={!loaded}>
                  <Download /> Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {EXPORTS.map((entry) => (
                  <DropdownMenuItem key={entry.action} onSelect={() => invoke(entry.action)}>
                    {entry.label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={downloadFile}>draw.io file (.drawio)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      <div className="relative min-h-0 flex-1">
        {!loaded && (
          <div className="absolute inset-0 grid content-start gap-2 p-6" aria-label="Opening diagram">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}
        {live?.synced && (
          <iframe
            key={src}
            ref={frame}
            src={src}
            title={`Diagram: ${item.name}`}
            className="size-full border-0"
            allow="clipboard-read; clipboard-write; fullscreen"
          />
        )}
      </div>
    </div>
  );
}
