"use client";

import { prettyJson, type HttpResponseData, type HttpSendFailure } from "@codechatter/contracts";
import { Check, CircleAlert, Copy, Download, Loader2, Save, TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

import type { RunState } from "./execute";
import { formatBytes, formatMs, statusTone } from "./format";
import { LinesView } from "./lines-view";
import { setExample, type RequestData } from "./model";
import { StudioTabs, TabCount } from "./studio-tabs";
import { useStudio } from "./studio-context";

type Tab = "body" | "raw" | "headers" | "preview" | "tests";

const RAW_LIMIT = 1024 * 1024;
const EXAMPLE_LIMIT = 256 * 1024;

export const headerValue = (headers: Array<[string, string]>, name: string) => headers.find(([key]) => key.toLowerCase() === name)?.[1] ?? "";

const FAILURE_TITLES: Record<HttpSendFailure["code"], string> = {
  invalid_request: "This request can't be sent",
  blocked: "Blocked for safety",
  dns: "Host not found",
  refused: "Connection refused",
  timeout: "Timed out",
  tls: "Secure connection failed",
  network: "Network error",
  sandbox_not_listening: "Nothing is listening in the sandbox",
  sandbox_unavailable: "The sandbox isn't reachable",
};

function base64Bytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** The previewable kind of a response, from its content type. */
function previewKind(type: string): "html" | "image" | null {
  if (/^text\/html|^application\/xhtml/i.test(type)) return "html";
  if (/^image\//i.test(type)) return "image";
  return null;
}

export function ResponsePane({ request }: { request: RequestData }) {
  const { runs } = useStudio();
  const run = runs[request.id];

  if (!run) {
    return (
      <section aria-label="Response" className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="font-medium">No response yet</p>
        <p className="text-sm text-muted-foreground">
          Press Send, or <Kbd>Ctrl</Kbd> <Kbd>Enter</Kbd>, to see the response here.
        </p>
      </section>
    );
  }
  if (run.phase === "sending") {
    return (
      <section aria-label="Response" aria-busy className="flex h-full items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Sending...
      </section>
    );
  }
  if (run.problem) {
    return (
      <section aria-label="Response" className="p-4">
        <Notice tone="warning" title={run.problem === "Cancelled." ? "Cancelled" : "Couldn't send"}>
          {run.problem === "Cancelled." ? "The request was cancelled before an answer came back." : run.problem}
        </Notice>
      </section>
    );
  }
  if (run.result && !run.result.ok) {
    const failure = run.result;
    return (
      <section aria-label="Response" className="grid content-start gap-2 p-4">
        <Notice tone="error" title={FAILURE_TITLES[failure.code]}>
          {failure.message}
        </Notice>
        <p className="text-xs text-muted-foreground">
          {failure.target === "sandbox" ? "Sent to this room's sandbox" : "Sent to the internet"} after {formatMs(failure.timing.totalMs)}.
        </p>
        <Checks run={run} />
      </section>
    );
  }
  if (run.result?.ok) return <Answer key={run.finishedAt} request={request} run={run} response={run.result} />;
  return null;
}

function Notice({ tone, title, children }: { tone: "warning" | "error"; title: string; children: React.ReactNode }) {
  const Icon = tone === "error" ? CircleAlert : TriangleAlert;
  return (
    <div role="alert" className={cn("flex gap-2 rounded-md border p-3", tone === "error" ? "border-destructive/50" : "border-warning/50")}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", tone === "error" ? "text-destructive" : "text-warning")} aria-hidden />
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        <p className="mt-0.5 text-sm break-words text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

function Answer({ request, run, response }: { request: RequestData; run: RunState; response: HttpResponseData }) {
  const { doc, user, canEdit } = useStudio();
  const [tab, setTab] = useState<Tab>("body");
  const type = headerValue(response.headers, "content-type");
  const binary = response.bodyEncoding === "base64";
  const preview = previewKind(type);
  const pretty = binary ? null : prettyJson(response.body);
  const passed = run.checks.filter((c) => c.passed).length;
  const failed = run.checks.length - passed;

  const copyBody = async () => toast[(await copyText(binary ? "" : response.body)) ? "success" : "error"](binary ? "Binary responses can't be copied. Download it instead." : "Copied the response body.");

  const download = () => {
    const link = document.createElement("a");
    const blob = binary ? new Blob([base64Bytes(response.body)], { type }) : new Blob([response.body], { type: type || "text/plain" });
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `response${/json/.test(type) ? ".json" : /html/.test(type) ? ".html" : /image\/(\w+)/.exec(type) ? `.${/image\/(\w+)/.exec(type)![1]}` : binary ? ".bin" : ".txt"}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const saveExample = () => {
    if (response.size > EXAMPLE_LIMIT) {
      toast.error("This response is over 256 KB, too big to keep as an example.");
      return;
    }
    setExample(doc, request.id, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      body: response.body,
      bodyEncoding: response.bodyEncoding,
      savedAt: Date.now(),
      savedBy: user.name,
    });
    toast.success("Saved as the example for this request.");
  };

  return (
    <section aria-label="Response" className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-4 border-b bg-chrome px-3 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Status</span>
          <span className={cn("font-medium tabular-nums", statusTone(response.status))}>
            {response.status} {response.statusText}
          </span>
        </span>
        <span className="flex items-center gap-1.5" title={`First byte after ${formatMs(response.timing.firstByteMs)}`}>
          <span className="text-muted-foreground">Time</span>
          <span className="font-medium tabular-nums">{formatMs(response.timing.totalMs)}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Size</span>
          <span className="font-medium tabular-nums">{formatBytes(response.size)}</span>
        </span>
        <span className="hidden text-muted-foreground sm:inline">{response.target === "sandbox" ? "From this room's sandbox" : "From the internet"}</span>
        <div className="ml-auto flex items-center gap-0.5">
          {canEdit && (
            <Button size="xs" variant="ghost" onClick={saveExample} title="Keep this response as the example for the request">
              <Save /> Save example
            </Button>
          )}
          <Button size="icon-xs" variant="ghost" aria-label="Copy response body" onClick={copyBody} disabled={binary}>
            <Copy />
          </Button>
          <Button size="icon-xs" variant="ghost" aria-label="Download response body" onClick={download}>
            <Download />
          </Button>
        </div>
      </div>
      {(response.notice || run.warnings.length > 0 || response.truncated) && (
        <ul className="shrink-0 border-b bg-panel px-3 py-1 text-xs text-warning">
          {response.truncated && <li>The response was cut at 5 MB. Download keeps what was received.</li>}
          {response.notice && <li>{response.notice}</li>}
          {run.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      <StudioTabs
        label="Response"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "body", label: "Body" },
          { id: "raw", label: "Raw" },
          { id: "headers", label: <>Headers <TabCount n={response.headers.length} /></> },
          { id: "preview", label: "Preview", hidden: !preview },
          {
            id: "tests",
            label: (
              <>
                Tests
                {run.checks.length > 0 && (
                  <span className={cn("text-2xs tabular-nums", failed ? "text-destructive" : "text-success")}>
                    {passed}/{run.checks.length}
                  </span>
                )}
              </>
            ),
          },
        ]}
      />
      <div className="min-h-0 flex-1">
        {tab === "body" &&
          (binary ? (
            <BinaryNote type={type} size={response.size} onDownload={download} />
          ) : response.body === "" ? (
            <p className="p-4 text-sm text-muted-foreground">The response has no body.</p>
          ) : (
            <LinesView text={pretty ?? response.body} mode={pretty ? "json" : "plain"} label="response body" />
          ))}
        {tab === "raw" && <RawBody body={response.body} binary={binary} size={response.size} onDownload={download} type={type} />}
        {tab === "headers" && <HeadersTable headers={response.headers} />}
        {tab === "preview" && preview && <Preview kind={preview} type={type} body={response.body} binary={binary} />}
        {tab === "tests" && (
          <div className="h-full overflow-auto p-3">
            <Checks run={run} />
          </div>
        )}
      </div>
    </section>
  );
}

function BinaryNote({ type, size, onDownload }: { type: string; size: number; onDownload: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="font-medium">Binary response</p>
      <p className="text-sm text-muted-foreground">
        {type || "Unknown type"}, {formatBytes(size)}. There&apos;s no text to show.
      </p>
      <Button size="sm" variant="outline" onClick={onDownload}>
        <Download /> Download
      </Button>
    </div>
  );
}

function RawBody({ body, binary, size, onDownload, type }: { body: string; binary: boolean; size: number; onDownload: () => void; type: string }) {
  if (binary) return <BinaryNote type={type} size={size} onDownload={onDownload} />;
  const cut = body.length > RAW_LIMIT;
  return (
    <div className="h-full overflow-auto p-3">
      <pre className="font-mono text-sm break-all whitespace-pre-wrap">{cut ? body.slice(0, RAW_LIMIT) : body}</pre>
      {cut && <p className="pt-2 text-xs text-muted-foreground">Showing the first 1 MB. Download has the rest.</p>}
    </div>
  );
}

function HeadersTable({ headers }: { headers: Array<[string, string]> }) {
  return (
    <div className="h-full overflow-auto">
      <table className="w-full table-fixed text-sm">
        <caption className="sr-only">Response headers</caption>
        <tbody>
          {headers.map(([name, value], i) => (
            <tr key={`${name}-${i}`} className="border-b align-top last:border-0">
              <th scope="row" className="w-2/5 px-3 py-1 text-left font-mono font-medium break-all">
                {name}
              </th>
              <td className="px-3 py-1 font-mono break-all text-muted-foreground">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Preview({ kind, type, body, binary }: { kind: "html" | "image"; type: string; body: string; binary: boolean }) {
  if (kind === "image") {
    const src = binary ? `data:${type.split(";")[0]};base64,${body}` : `data:${type.split(";")[0]};charset=utf-8,${encodeURIComponent(body)}`;
    return (
      <div className="flex h-full items-center justify-center overflow-auto bg-panel p-4">
        {/* A data: URL from the response itself; next/image can't optimise it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="Response" className="max-h-full max-w-full object-contain" />
      </div>
    );
  }
  // No scripts, no network, opaque origin: this only shows how the markup lays out.
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">`;
  return <iframe title="Response preview" sandbox="" srcDoc={`<!doctype html>${csp}${body}`} className="size-full bg-white" />;
}

export function Checks({ run }: { run: RunState }) {
  if (run.checks.length === 0 && run.extracted.length === 0) {
    return <p className="text-sm text-muted-foreground">This request has no tests. Add some in the Tests tab to check every response.</p>;
  }
  return (
    <div className="grid gap-3">
      {run.checks.length > 0 && (
        <ul className="grid gap-1" aria-label="Test results">
          {run.checks.map((check) => (
            <li key={check.id} className="flex items-start gap-2 text-sm">
              {check.passed ? <Check className="mt-0.5 size-4 shrink-0 text-success" aria-label="Passed" /> : <X className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="Failed" />}
              <span className="min-w-0">
                <span>{check.name}</span>
                {check.message && !check.passed && <span className="block text-xs text-muted-foreground">{check.message}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {run.extracted.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">Variables set</h4>
          <ul className="grid gap-1 text-sm">
            {run.extracted.map((item, i) => (
              <li key={`${item.variable}-${i}`} className="flex items-start gap-2">
                {item.error ? <X className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="Not set" /> : <Check className="mt-0.5 size-4 shrink-0 text-success" aria-label="Set" />}
                <span className="min-w-0 break-words">
                  <span className="font-mono">{`{{${item.variable || "?"}}}`}</span>
                  <span className="text-muted-foreground"> {item.error ?? `set to ${item.value && item.value.length > 80 ? `${item.value.slice(0, 80)}...` : item.value}`}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
