/** Export audit events as spreadsheet-safe CSV, including names and details without letting cells run formulas. */
import type { AuditEventItem } from "@codechatter/contracts";

export const AUDIT_CSV_HEADER = ["Time", "Person", "Email", "Action", "Target type", "Target", "Room name", "Details", "IP", "User agent"] as const;

export function auditCsvCell(value: string | null | undefined): string {
  let text = value ?? "";
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function auditCsv(items: readonly AuditEventItem[]): string {
  const rows: Array<readonly (string | null | undefined)[]> = [AUDIT_CSV_HEADER];
  for (const item of items) {
    rows.push([
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
    ]);
  }
  // A BOM helps Excel recognise UTF-8; CRLF and a final newline follow RFC 4180.
  return `\uFEFF${rows.map((row) => row.map(auditCsvCell).join(",")).join("\r\n")}\r\n`;
}
