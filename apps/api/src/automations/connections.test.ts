import { describe, expect, it } from "vitest";

import { openToken, sealToken } from "../github/token-box.js";
import { CONNECTION_PURPOSE, entriesOf, forRun, openedValue, plainConnectionError, shownConnectionOf, storedOf } from "./connections.js";

const SECRET = "a".repeat(48);
const seal = (text: string) => sealToken(SECRET, text, CONNECTION_PURPOSE);
const open = (sealed: string) => openToken(SECRET, sealed, CONNECTION_PURPOSE);
const asha = { id: "u1", name: "Asha" };
const roomDb = { name: "room-db", piece: "@activepieces/piece-postgres", value: { type: "CUSTOM_AUTH" as const, props: { host: "postgres", port: 5432, user: "app", password: "hunter2", database: "app" } }, shown: ["host", "port", "user", "password", "database"] };

describe("a room's connections", () => {
  it("are kept sealed, and show nothing secret", () => {
    const stored = storedOf(roomDb, asha, seal, undefined, 1000);
    expect(JSON.stringify(stored)).not.toContain("hunter2");
    expect(stored).toMatchObject({ piece: "@activepieces/piece-postgres", type: "CUSTOM_AUTH", shown: { host: "postgres", port: 5432, user: "app", database: "app" }, createdBy: asha, createdAt: 1000, updatedAt: 1000, lastTest: null });
    expect(JSON.stringify(shownConnectionOf("room-db", stored))).not.toContain("hunter2");
    expect(openedValue(stored, open)).toEqual(roomDb.value);
  });

  it("can't be opened under another purpose's key, or another secret", () => {
    const stored = storedOf(roomDb, asha, seal);
    expect(openedValue(stored, (sealed) => openToken(SECRET, sealed))).toBeNull();
    expect(openedValue(stored, (sealed) => openToken("b".repeat(48), sealed, CONNECTION_PURPOSE))).toBeNull();
  });

  it("replaced, keep who made them and when, and are tried again", () => {
    const first = { ...storedOf(roomDb, asha, seal, undefined, 1000), lastTest: { valid: true, error: null, at: 1500 } };
    const again = storedOf({ ...roomDb, value: { ...roomDb.value, props: { ...roomDb.value.props, password: "new" } } }, { id: "u2", name: "Ben" }, seal, first, 2000);
    expect(again).toMatchObject({ createdBy: asha, createdAt: 1000, updatedAt: 2000, lastTest: null });
  });

  it("go to a run opened, by name, leaving out any that can't be opened", () => {
    const all = entriesOf({ automationConnections: { "room-db": storedOf(roomDb, asha, seal), broken: { ...storedOf(roomDb, asha, seal), sealed: "v1.x.y.z" } }, other: 1 });
    expect(forRun(all, open)).toEqual({ "room-db": { piece: "@activepieces/piece-postgres", value: roomDb.value } });
    expect(entriesOf(null)).toEqual({});
    expect(entriesOf({ automationConnections: [1] })).toEqual({});
  });
});

describe("why a connection didn't work", () => {
  it("says it in plain words, from a driver's error code", () => {
    expect(plainConnectionError('{"length":99,"name":"error","severity":"FATAL","code":"28P01","file":"auth.c","routine":"auth_failed"}')).toBe("The user name or password is wrong. (28P01)");
    expect(plainConnectionError('{"code":"ECONNREFUSED","errno":-111}')).toBe("Nothing answered at that host and port. Is the database running? (ECONNREFUSED)");
    expect(plainConnectionError('{"code":"XX000","routine":"something_odd"}')).toBe("It was refused: something_odd (XX000).");
    expect(plainConnectionError('{"message":"Invalid token"}')).toBe("Invalid token");
    expect(plainConnectionError("The bot token is invalid.")).toBe("The bot token is invalid.");
    expect(plainConnectionError("")).toBe("It didn't work with these details.");
    expect(plainConnectionError("{}")).toBe("It didn't work with these details.");
  });
});
