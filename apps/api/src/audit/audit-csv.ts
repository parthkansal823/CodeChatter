/** Export audit events as spreadsheet-safe CSV, including names and details without letting cells run formulas. */
import type { AuditEventItem } from "@codechatter/contracts";
import { once } from "node:events";
import type { Writable } from "node:stream";
import { finished } from "node:stream/promises";

export const AUDIT_CSV_HEADER = ["Time", "Person", "Email", "Action", "Target type", "Target", "Room name", "Details", "IP", "User agent"] as const;
export const AUDIT_CSV_PAGE_SIZE = 1_000;
export const AUDIT_CSV_LIMIT = 100_000;
export const AUDIT_CSV_TRUNCATED = "# Stopped at 100,000 events; narrow the filters to export the rest.\r\n";
export const AUDIT_CSV_FAILED = "# Export failed; download again.\r\n";

export function auditCsvCell(value: string | null | undefined): string {
  let text = value ?? "";
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function auditCsv(items: readonly AuditEventItem[]): string {
  // A BOM helps Excel recognise UTF-8; CRLF and a final newline follow RFC 4180.
  return `\uFEFF${AUDIT_CSV_HEADER.map(auditCsvCell).join(",")}\r\n${items.map(auditCsvRow).join("")}`;
}

export function auditCsvRow(item: AuditEventItem): string {
  return [
      item.at,
      item.actor?.name,
      item.actor?.email,
      item.action,
      item.targetType,
      item.targetId,
      item.room?.name,
      item.data === null ? "" : JSON.stringify(item.data),
      item.ip,
      item.userAgent,
    ].map(auditCsvCell).join(",") + "\r\n";
}

/** Keep one page in memory, respect socket backpressure and mark errors after CSV output has begun. */
export async function streamAuditCsv(
  response: Writable,
  readPage: (before: string | undefined, limit: number) => Promise<readonly AuditEventItem[]>,
  options: { truncated: boolean; onError: (error: unknown) => void },
): Promise<void> {
  const cancellation = new AbortController();
  const closed = () => cancellation.abort();
  let outputError: unknown;
  const failed = (error: Error) => { outputError = error; cancellation.abort(); report(error); };
  response.once("close", closed);
  let reported = false;
  const report = (error: unknown) => { if (!reported) { reported = true; options.onError(error); } };
  response.once("error", failed);
  const write = async (text: string) => {
    if (response.destroyed || response.writableEnded) return false;
    if (!response.write(text)) await once(response, "drain", { signal: cancellation.signal });
    return !response.destroyed && !cancellation.signal.aborted;
  };
  try {
    if (!await write(auditCsv([]))) return;
    let before: string | undefined;
    let count = 0;
    while (count < AUDIT_CSV_LIMIT && !cancellation.signal.aborted) {
      const limit = Math.min(AUDIT_CSV_PAGE_SIZE, AUDIT_CSV_LIMIT - count);
      const page = await readPage(before, limit);
      if (cancellation.signal.aborted) break;
      if (page.length > limit) throw new Error("Audit export page exceeded its limit.");
      if (!page.length) break;
      if (!await write(page.map(auditCsvRow).join(""))) return;
      count += page.length;
      before = page.at(-1)!.id;
      if (page.length < limit) break;
    }
    if (options.truncated && !await write(AUDIT_CSV_TRUNCATED)) return;
    if (!response.destroyed && !response.writableEnded) response.end();
  } catch (error) {
    if (outputError || !cancellation.signal.aborted) report(outputError ?? error);
    if (!response.destroyed && !response.writableEnded) response.end(AUDIT_CSV_FAILED);
  } finally {
    // Keep the error listener until buffered writes finish, including a slow client's final chunk.
    if (!response.destroyed && !response.writableFinished) {
      await finished(response, { readable: false, cleanup: true }).catch((error: unknown) => {
        if (outputError) report(error);
      });
    }
    response.off("close", closed);
    response.off("error", failed);
  }
}
