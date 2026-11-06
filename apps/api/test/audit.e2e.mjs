/** Exercise organisation audit access, filters, paging and safe CSV downloads using a disposable room. */
import { setTimeout as sleep } from "node:timers/promises";

import { AuditActions, AuditActors, AuditPage } from "@codechatter/contracts";

const BASE = process.env.APP_URL ?? "http://localhost:8080";
const results = [];
function check(name, passed, detail = "") {
  results.push(Boolean(passed));
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${String(detail).replace(/\s+/g, " ").slice(0, 180)}` : ""}`);
}

function person() {
  const cookies = new Map();
  return async (path, { method = "GET", body, accept = "application/json" } = {}) => {
    const response = await fetch(`${BASE}${path}`, {
      method,
      signal: AbortSignal.timeout(30_000),
      headers: {
        origin: BASE,
        accept,
        ...(body !== undefined && { "content-type": "application/json" }),
        ...(cookies.size && { cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; ") }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(";", 1)[0];
      const at = pair.indexOf("=");
      if (at === -1) continue;
      const name = pair.slice(0, at);
      const value = pair.slice(at + 1);
      if (value) cookies.set(name, value);
      else cookies.delete(name);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const text = bytes.toString("utf8");
    let json;
    try { json = JSON.parse(text); } catch { /* CSV and empty responses are not JSON. */ }
    return { status: response.status, headers: response.headers, bytes, text, json };
  };
}

function csvRows(csv) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const text = csv.replace(/^\uFEFF/, "");
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (char === '"') {
      if (quoted && text[at + 1] === '"') { cell += '"'; at++; }
      else quoted = !quoted;
    } else if (!quoted && char === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && (char === "\r" || char === "\n")) {
      if (char === "\r" && text[at + 1] === "\n") at++;
      rows.push([...row, cell]);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (row.length || cell) rows.push([...row, cell]);
  return rows;
}

const one = person();
const two = person();
let roomId;
let needsCleanup = false;
let streamingRoomId;
try {
  const signIn = (call, email) => call("/api/auth/sign-in/email", { method: "POST", body: { email, password: "codechatter123" } });
  const owner = await signIn(one, "test1@codechatter.local");
  const other = await signIn(two, "test2@codechatter.local");
  check("signedIn", owner.status === 200 && other.status === 200, `${owner.status}, ${other.status}`);
  if (owner.status !== 200 || other.status !== 200) throw new Error("The test accounts could not sign in.");

  const me = (await one("/api/me")).json;
  const orgId = me?.session?.activeOrganizationId;
  const org = me?.organizations?.find((item) => item.id === orgId);
  check("activeOrgOwned", Boolean(orgId) && ["owner", "admin"].includes(org?.role));
  if (!orgId || !["owner", "admin"].includes(org?.role)) throw new Error("test1 must own or administer its active organisation.");
  const audit = `/api/orgs/${encodeURIComponent(orgId)}/audit`;
  const name = `=Audit e2e "${Date.now().toString(36)}", CSV`;
  const from = new Date(Date.now() - 2_000).toISOString();
  const created = await one("/api/rooms", { method: "POST", body: { name } });
  roomId = created.json?.id;
  needsCleanup = Boolean(roomId);
  check("roomCreated", created.status === 201 && /^[A-Z0-9]{6}$/.test(roomId ?? ""), created.status);
  if (!roomId) throw new Error("The disposable room could not be created.");
  const removed = await one(`/api/rooms/${roomId}`, { method: "DELETE" });
  check("roomDeleted", removed.status === 204, removed.status);
  needsCleanup = removed.status !== 204;

  const filter = new URLSearchParams({ room: roomId, from });
  let list;
  for (let attempt = 0; attempt < 20; attempt++) {
    list = await one(`${audit}?${filter}`);
    if (list.json?.items?.some((item) => item.action === "room.create") && list.json.items.some((item) => item.action === "room.delete")) break;
    if (list.status !== 200) break;
    await sleep(250);
  }
  const page = list.json;
  const items = page?.items ?? [];
  check("listContract", list.status === 200 && AuditPage.safeParse(page).success, list.status);
  check("bothEventsRecorded", ["room.create", "room.delete"].every((action) => items.some((item) => item.action === action && item.targetId === roomId)));
  check("newestFirst", items.length >= 2 && items.every((item, index) => index === 0 || items[index - 1].id > item.id) && items.findIndex((item) => item.action === "room.delete") < items.findIndex((item) => item.action === "room.create"));
  check("roomFilter", items.length >= 2 && items.every((item) => item.targetType === "room" && item.targetId === roomId));

  const actionFilter = new URLSearchParams(filter);
  actionFilter.set("action", "room.create");
  const byAction = await one(`${audit}?${actionFilter}`);
  check("actionFilter", byAction.status === 200 && byAction.json.items.length >= 1 && byAction.json.items.every((item) => item.action === "room.create"));
  const actorFilter = new URLSearchParams(filter);
  actorFilter.set("actorId", me.user.id);
  const byActor = await one(`${audit}?${actorFilter}`);
  check("personFilter", byActor.status === 200 && byActor.json.items.length >= 2 && byActor.json.items.every((item) => item.actor?.id === me.user.id));
  const future = await one(`${audit}?room=${roomId}&from=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`);
  check("dateFilter", future.status === 200 && future.json.items.length === 0 && future.json.next === null);

  const firstParams = new URLSearchParams(filter);
  firstParams.set("limit", "1");
  const first = await one(`${audit}?${firstParams}`);
  const cursor = first.json?.next;
  const secondParams = new URLSearchParams(firstParams);
  if (cursor) secondParams.set("before", cursor);
  const second = await one(`${audit}?${secondParams}`);
  check("beforePaging", first.status === 200 && second.status === 200 && first.json.items.length === 1 && cursor === first.json.items[0].id && second.json.items.length === 1 && second.json.items[0].id < cursor && second.json.items[0].id !== first.json.items[0].id && second.json.next === null);

  const actions = await one(`${audit}/actions`);
  check("actionsFromLog", actions.status === 200 && AuditActions.safeParse(actions.json).success && ["room.create", "room.delete"].every((action) => actions.json.actions.includes(action)));
  const actors = await one(`${audit}/actors`);
  check("peopleFromLog", actors.status === 200 && AuditActors.safeParse(actors.json).success && actors.json.actors.some((actor) => actor.id === me.user.id));

  const csv = await one(`${audit}/export.csv?${filter}`, { accept: "text/csv" });
  const rows = csvRows(csv.text);
  check("csvHeaders", csv.status === 200 && /^text\/csv;\s*charset=utf-8/i.test(csv.headers.get("content-type") ?? "") && /^attachment; filename="audit-.+-\d{4}-\d{2}-\d{2}\.csv"$/.test(csv.headers.get("content-disposition") ?? ""));
  check("csvHasBomAndColumns", csv.bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191])) && JSON.stringify(rows[0]) === JSON.stringify(["Time", "Person", "Email", "Action", "Target type", "Target", "Room name", "Details", "IP", "User agent"]));
  check("csvHasBothEvents", ["room.create", "room.delete"].every((action) => rows.slice(1).some((row) => row[3] === action && row[5] === roomId)));
  check("csvDefusesFormulaAndEscapesNames", rows.slice(1).filter((row) => row[5] === roomId).length >= 2 && rows.slice(1).filter((row) => row[5] === roomId).every((row) => row[6] === `'${name}` && JSON.parse(row[7]).name === name));
  const filteredCsv = await one(`${audit}/export.csv?${actionFilter}`, { accept: "text/csv" });
  const filteredRows = csvRows(filteredCsv.text).slice(1);
  check("csvUsesFilters", filteredCsv.status === 200 && filteredRows.length >= 1 && filteredRows.every((row) => row[3] === "room.create" && row[5] === roomId));

  for (const suffix of ["", "/actions", "/actors", "/export.csv"]) {
    const forbidden = await two(audit + suffix);
    check(`otherPersonForbidden${suffix || "/list"}`, forbidden.status === 403, forbidden.status);
  }
  const missing = await one(`/api/orgs/missing-audit-${Date.now().toString(36)}/audit`);
  check("missingOrgNotFound", missing.status === 404, missing.status);
  const anonymous = await person()(audit);
  check("signInRequired", anonymous.status === 401, anonymous.status);

  for (const query of ["limit=0", "limit=201", "limit=1.5", "limit=", "limit=1&limit=2", "room=bad", "actorId=", "action=" + "x".repeat(65), "from=yesterday", "before=bad", "from=2026-11-05T00%3A00%3A00Z&to=2026-11-04T00%3A00%3A00Z", "unknown=value"]) {
    const invalid = await one(`${audit}?${query}`);
    check(`invalidQuery ${query.slice(0, 45)}`, invalid.status === 400, invalid.status);
  }
  const invalidExport = await one(`${audit}/export.csv?limit=1`);
  check("exportRejectsPaging", invalidExport.status === 400, invalidExport.status);

  // One disposable room creates enough real audit entries to cross a 1,000-row CSV page.
  const streamingRoom = await one("/api/rooms", { method: "POST", body: { name: "Audit streaming export e2e" } });
  streamingRoomId = streamingRoom.json?.id;
  if (streamingRoom.status !== 201 || !streamingRoomId) throw new Error("The streaming export room could not be created.");
  const updateCount = 1_001;
  for (let index = 0; index < updateCount; index++) {
    const updated = await one(`/api/rooms/${streamingRoomId}`, { method: "PATCH", body: { description: `CSV page fixture ${index}` } });
    if (updated.status !== 200) throw new Error(`Streaming export fixture update ${index} returned ${updated.status}.`);
    if ((index + 1) % 250 === 0) console.log(`Created ${index + 1}/${updateCount} streaming export events`);
  }
  const streamingFilter = new URLSearchParams({ room: streamingRoomId, action: "room.update" });
  const streamed = await one(`${audit}/export.csv?${streamingFilter}`, { accept: "text/csv" });
  const streamedRows = csvRows(streamed.text);
  const descriptions = streamedRows.slice(1).map((row) => { try { return JSON.parse(row[7]).description; } catch { return null; } });
  check("csvStreamsMoreThanOnePage", streamed.status === 200 && streamedRows.length === updateCount + 1 && streamedRows.slice(1).every((row) => row[3] === "room.update" && row[5] === streamingRoomId));
  check("csvPageBoundaryHasNoMissingOrDuplicateEvents", new Set(descriptions).size === updateCount && Array.from({ length: updateCount }, (_, index) => `CSV page fixture ${index}`).every((description) => descriptions.includes(description)));
  check("completeCsvIsNotMarkedTruncated", !streamed.headers.has("x-audit-truncated") && !streamed.text.includes("# Stopped at") && !streamed.text.includes("# Export failed"));
} catch (error) {
  check("flowCompletes", false, error instanceof Error ? error.message : String(error));
} finally {
  if (streamingRoomId) {
    const cleanup = await one(`/api/rooms/${streamingRoomId}`, { method: "DELETE" }).catch(() => null);
    check("streamingTestRoomCleanedUp", cleanup?.status === 204 || cleanup?.status === 404, cleanup?.status ?? "request failed");
  }
  if (needsCleanup && roomId) {
    const cleanup = await one(`/api/rooms/${roomId}`, { method: "DELETE" }).catch(() => null);
    check("testRoomCleanedUp", cleanup?.status === 204 || cleanup?.status === 404, cleanup?.status ?? "request failed");
  }
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
