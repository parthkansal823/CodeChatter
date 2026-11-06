/** Check audit CSV escaping and formula protection so exported logs remain readable and safe in spreadsheets. */
import type { AuditEventItem } from "@codechatter/contracts";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";

import { AUDIT_CSV_FAILED, AUDIT_CSV_HEADER, AUDIT_CSV_LIMIT, AUDIT_CSV_TRUNCATED, auditCsv, auditCsvCell, streamAuditCsv } from "./audit-csv.js";

const item: AuditEventItem = {
  id: "0199a000-0000-7000-8000-000000000001",
  at: "2026-11-04T10:30:00.000Z",
  actor: { id: "person-1", name: "Ana, María", email: "ana@example.test" },
  action: "room.create",
  targetType: "room",
  targetId: "TEAM22",
  room: { id: "TEAM22", name: "Shared room" },
  data: { name: "Shared room", note: 'Said "hello"' },
  ip: "127.0.0.1",
  userAgent: "Test browser",
};

describe("auditCsvCell", () => {
  it("quotes commas, quotes and either kind of newline", () => {
    expect(auditCsvCell("one,two")).toBe('"one,two"');
    expect(auditCsvCell('Said "hello"')).toBe('"Said ""hello"""');
    expect(auditCsvCell("first\nsecond")).toBe('"first\nsecond"');
    expect(auditCsvCell("first\rsecond")).toBe('"first\rsecond"');
    expect(auditCsvCell("first\r\nsecond")).toBe('"first\r\nsecond"');
  });

  it("defuses every spreadsheet formula prefix before escaping", () => {
    for (const text of ["=SUM(A1:A2)", "+123", "-123", "@SUM(A1)", "\tformula"]) {
      expect(auditCsvCell(text)).toBe(`'${text}`);
    }
    expect(auditCsvCell("\rformula")).toBe('"\'\rformula"');
    expect(auditCsvCell('=HYPERLINK("https://example.test","open")')).toBe('"\'=HYPERLINK(""https://example.test"",""open"")"');
  });

  it("keeps ordinary text and Unicode, and leaves missing values empty", () => {
    expect(auditCsvCell("Ana María")).toBe("Ana María");
    expect(auditCsvCell("an = ordinary label")).toBe("an = ordinary label");
    expect(auditCsvCell(null)).toBe("");
    expect(auditCsvCell(undefined)).toBe("");
  });
});

describe("streamAuditCsv", () => {
  function output(slow = false) {
    const chunks: string[] = [];
    const response = new Writable({
      highWaterMark: slow ? 1 : 16_384,
      write(chunk, _encoding, done) {
        chunks.push(chunk.toString());
        if (slow) setImmediate(done);
        else done();
      },
    });
    return { response, text: () => chunks.join("") };
  }
  const events = (count: number) => Array.from({ length: count }, (_, i) => ({ ...item, id: String(count - i).padStart(10, "0") }));

  it("streams multiple cursor pages with one BOM/header and respects backpressure", async () => {
    const rows = events(1_001);
    const { response, text } = output(true);
    const reads: Array<[string | undefined, number]> = [];
    const errors: unknown[] = [];
    await streamAuditCsv(response, async (before, limit) => {
      reads.push([before, limit]);
      const offset = before ? rows.findIndex((row) => row.id === before) + 1 : 0;
      return rows.slice(offset, offset + limit);
    }, { truncated: false, onError: (error) => errors.push(error) });
    expect(reads).toEqual([[undefined, 1_000], [rows[999]!.id, 1_000]]);
    expect(text()).toBe(auditCsv(rows));
    expect(errors).toHaveLength(0);
    expect(response.writableFinished).toBe(true);
  });

  it("stops at 100,000 rows and includes the exact truncation footer", async () => {
    const { response, text } = output();
    let count = 0;
    let reads = 0;
    await streamAuditCsv(response, async (_before, limit) => {
      reads++;
      const rows = Array.from({ length: limit }, () => ({ ...item, id: String(++count) }));
      return rows;
    }, { truncated: true, onError: () => { throw new Error("Unexpected export error"); } });
    expect(count).toBe(AUDIT_CSV_LIMIT);
    expect(reads).toBe(100);
    expect(text().endsWith(AUDIT_CSV_TRUNCATED)).toBe(true);
  });

  it("marks a database failure after a complete page instead of appending JSON", async () => {
    const { response, text } = output();
    const failure = new Error("Fixture page failed");
    const errors: unknown[] = [];
    let reads = 0;
    await streamAuditCsv(response, async () => {
      if (reads++) throw failure;
      return events(1_000);
    }, { truncated: false, onError: (error) => errors.push(error) });
    expect(text().endsWith(AUDIT_CSV_FAILED)).toBe(true);
    expect(errors).toEqual([failure]);
    expect(text()).not.toContain(failure.message);
  });

  it("stops reading when the client disconnects during a page fetch", async () => {
    const { response, text } = output();
    let reads = 0;
    const errors: unknown[] = [];
    await streamAuditCsv(response, async () => {
      reads++;
      response.destroy();
      return events(1_000);
    }, { truncated: false, onError: (error) => errors.push(error) });
    expect(reads).toBe(1);
    expect(text()).toBe(auditCsv([]));
    expect(errors).toHaveLength(0);
  });
});

describe("auditCsv", () => {
  it("starts an empty table with a UTF-8 BOM and the complete header", () => {
    expect(auditCsv([])).toBe(`\uFEFF${AUDIT_CSV_HEADER.join(",")}\r\n`);
    expect(AUDIT_CSV_HEADER).toEqual(["Time", "Person", "Email", "Action", "Target type", "Target", "Room name", "Details", "IP", "User agent"]);
  });

  it("exports events in the supplied order with all columns and JSON details", () => {
    const csv = auditCsv([item, { ...item, action: "room.delete" }]);
    const expected = `${item.at},"Ana, María",ana@example.test,room.create,room,TEAM22,Shared room,${auditCsvCell(JSON.stringify(item.data))},127.0.0.1,Test browser\r\n`;
    expect(csv).toContain(expected);
    expect(csv.indexOf("room.create")).toBeLessThan(csv.indexOf("room.delete"));
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("defuses people, room names, targets and request metadata independently", () => {
    const csv = auditCsv([{ ...item, actor: { id: "person-1", name: "=name", email: "+email" }, room: { id: "TEAM22", name: "@room" }, targetId: "-target", ip: "\tIP", userAgent: "\ragent" }]);
    expect(csv).toContain(",'=name,'+email,room.create,room,'-target,'@room,");
    expect(csv).toContain(",'\tIP,\"'\ragent\"\r\n");
  });

  it("exports missing actors, rooms, metadata and details as empty cells", () => {
    const csv = auditCsv([{ ...item, actor: null, room: null, targetType: null, targetId: null, data: null, ip: null, userAgent: null }]);
    expect(csv).toContain(`${item.at},,,room.create,,,,,,\r\n`);
  });
});
