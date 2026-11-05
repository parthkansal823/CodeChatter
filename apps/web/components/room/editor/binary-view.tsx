"use client";

import { blobView, type BlobRef } from "@codechatter/contracts";
import { findByPath, setBlob, type TreeNode } from "@codechatter/workspace-model";
import { Download, FileQuestion, RefreshCw } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { blobUrl, fetchBlob, formatBytes, uploadBlob } from "@/lib/blobs";

/**
 * A binary room file (an image, a PDF, a font, audio or video), shown in place of the
 * code editor: the file tree holds its blob, and the bytes come from the API. Images,
 * audio and video load from the blob's URL; PDFs and fonts are fetched first (a PDF is
 * never opened from the API's URL, which downloads); anything else gets a hex peek.
 * People who can edit can replace the file with another from their computer.
 */
export function BinaryView({ file }: { file: TreeNode & { blob: BlobRef } }) {
  const { room, doc, can } = useRoom();
  const picker = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState(false);
  const view = blobView(file.blob.type);
  const src = blobUrl(room.id, file.blob.sha256);

  const replace = async (picked: File | undefined) => {
    if (!picked) return;
    setReplacing(true);
    try {
      const blob = await uploadBlob(room.id, picked, file.name, picked.type);
      // The path, not the id we opened: the file may have moved while the upload ran.
      const node = findByPath(doc, file.path) ?? file;
      setBlob(doc, node.id, blob);
      toast.success(`Replaced ${file.name}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The upload failed.");
    } finally {
      setReplacing(false);
    }
  };

  return (
    <section aria-label={`Binary file ${file.name}`} className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b bg-chrome pr-1 pl-3 text-xs text-muted-foreground">
        <span className="truncate text-foreground">{file.name}</span>
        <span className="shrink-0">
          {file.blob.type} · {formatBytes(file.blob.size)}
        </span>
        <span className="ml-auto" />
        {can("files.edit") && (
          <>
            <input ref={picker} type="file" hidden aria-label="Replacement file" onChange={(event) => void replace(event.target.files?.[0])} />
            <Button variant="ghost" size="xs" disabled={replacing} onClick={() => picker.current?.click()}>
              <RefreshCw /> {replacing ? "Replacing…" : "Replace"}
            </Button>
          </>
        )}
        <Button variant="ghost" size="xs" asChild>
          <a href={blobUrl(room.id, file.blob.sha256, file.name)} download={file.name}>
            <Download /> Download
          </a>
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {view === "image" ? (
          <ImageView src={src} name={file.name} />
        ) : view === "pdf" ? (
          <PdfView roomId={room.id} blob={file.blob} name={file.name} />
        ) : view === "font" ? (
          <FontView roomId={room.id} blob={file.blob} />
        ) : view === "audio" ? (
          <div className="grid h-full place-items-center p-6">
            <audio controls src={src} aria-label={`Play ${file.name}`} className="w-full max-w-lg" />
          </div>
        ) : view === "video" ? (
          <div className="grid h-full place-items-center p-6">
            <video controls src={src} aria-label={`Play ${file.name}`} className="max-h-full max-w-full" />
          </div>
        ) : (
          <HexView roomId={room.id} blob={file.blob} />
        )}
      </div>
    </section>
  );
}

function ImageView({ src, name }: { src: string; name: string }) {
  const [fit, setFit] = useState(true);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [failed, setFailed] = useState(false);
  if (failed) return <Message>This image couldn&apos;t be shown. Download it to open it elsewhere.</Message>;
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground">
        {size && (
          <span>
            {size.width} × {size.height} px
          </span>
        )}
        <Button variant="ghost" size="xs" className="ml-auto" onClick={() => setFit((value) => !value)}>
          {fit ? "Actual size" : "Fit"}
        </Button>
      </div>
      <div className="grid flex-1 place-items-center overflow-auto bg-muted/40 p-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- a room file from the API, not a page asset */}
        <img
          src={src}
          alt={name}
          className={fit ? "max-h-full max-w-full object-contain" : "max-w-none"}
          onLoad={(event) => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
          onError={() => setFailed(true)}
        />
      </div>
    </div>
  );
}

/** Fetch a blob into an object URL of the given type, revoked when it's no longer shown. */
function useObjectUrl(roomId: string, blob: BlobRef): { url: string | null; error: string | null } {
  const [state, setState] = useState<{ key: string; url: string | null; error: string | null }>({ key: "", url: null, error: null });
  const key = `${roomId}:${blob.sha256}`;
  useEffect(() => {
    const abort = new AbortController();
    let url: string | null = null;
    fetchBlob(roomId, blob.sha256, { signal: abort.signal })
      .then((bytes) => {
        url = URL.createObjectURL(new Blob([bytes], { type: blob.type }));
        setState({ key, url, error: null });
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted) setState({ key, url: null, error: error instanceof Error ? error.message : "Couldn't load the file." });
      });
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [roomId, blob.sha256, blob.type, key]);
  return state.key === key ? state : { url: null, error: null };
}

function PdfView({ roomId, blob, name }: { roomId: string; blob: BlobRef; name: string }) {
  const { url, error } = useObjectUrl(roomId, blob);
  if (error) return <Message>{error}</Message>;
  if (!url) return <Message>Loading…</Message>;
  return <iframe src={url} title={name} className="h-full w-full border-0" />;
}

const SAMPLE = "The quick brown fox jumps over the lazy dog. 0123456789";

function FontView({ roomId, blob }: { roomId: string; blob: BlobRef }) {
  const family = `room-font-${blob.sha256.slice(0, 16)}`;
  const [state, setState] = useState<"loading" | "ready" | string>("loading");
  const [sample, setSample] = useState(SAMPLE);
  const inputId = useId();
  useEffect(() => {
    const abort = new AbortController();
    let face: FontFace | null = null;
    fetchBlob(roomId, blob.sha256, { signal: abort.signal })
      .then(async (bytes) => {
        face = new FontFace(family, bytes);
        await face.load();
        document.fonts.add(face);
        setState("ready");
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted) setState(error instanceof Error ? `This font couldn't be read: ${error.message}` : "This font couldn't be read.");
      });
    return () => {
      abort.abort();
      if (face) document.fonts.delete(face);
    };
  }, [roomId, blob.sha256, family]);
  if (state === "loading") return <Message>Loading the font…</Message>;
  if (state !== "ready") return <Message>{state}</Message>;
  return (
    <div className="grid gap-4 p-6">
      <div className="grid max-w-xl gap-1">
        <label htmlFor={inputId} className="text-xs text-muted-foreground">
          Sample text
        </label>
        <Input id={inputId} value={sample} onChange={(event) => setSample(event.target.value)} />
      </div>
      {[12, 16, 24, 36, 48].map((px) => (
        <div key={px} className="grid gap-1">
          <span className="text-xs text-muted-foreground">{px} px</span>
          <p style={{ fontFamily: `"${family}"`, fontSize: px }} className="break-words text-foreground">
            {sample || SAMPLE}
          </p>
        </div>
      ))}
    </div>
  );
}

function HexView({ roomId, blob }: { roomId: string; blob: BlobRef }) {
  const [rows, setRows] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    if (blob.size === 0) return;
    fetchBlob(roomId, blob.sha256, { range: "bytes=0-511", signal: abort.signal })
      .then((buffer) => setRows(hexRows(new Uint8Array(buffer).subarray(0, 512))))
      .catch((failure: unknown) => {
        if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : "Couldn't load the file.");
      });
    return () => abort.abort();
  }, [roomId, blob.sha256, blob.size]);
  return (
    <div className="grid gap-3 p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <FileQuestion className="size-4" />
        No preview for this kind of file. It&apos;s in the room and the sandbox as it is; download it to open it elsewhere.
      </div>
      {blob.size === 0 ? (
        <p className="text-xs text-muted-foreground">The file is empty.</p>
      ) : error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : rows ? (
        <pre aria-label="The file's first bytes" className="overflow-x-auto rounded-sm border bg-muted/40 p-3 font-mono text-xs leading-5">
          {rows.join("\n")}
          {blob.size > 512 && `\n… ${formatBytes(blob.size - 512)} more`}
        </pre>
      ) : null}
    </div>
  );
}

/** `00000000  89 50 4e 47 …  |.PNG…|`, 16 bytes a row. */
export function hexRows(bytes: Uint8Array): string[] {
  const rows: string[] = [];
  for (let at = 0; at < bytes.length; at += 16) {
    const chunk = bytes.subarray(at, at + 16);
    const hex = [...chunk].map((byte) => byte.toString(16).padStart(2, "0")).join(" ").padEnd(47, " ");
    const text = [...chunk].map((byte) => (byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : ".")).join("");
    rows.push(`${at.toString(16).padStart(8, "0")}  ${hex}  |${text}|`);
  }
  return rows;
}

function Message({ children }: { children: React.ReactNode }) {
  return <div className="grid h-full place-items-center p-6 text-xs text-muted-foreground">{children}</div>;
}
