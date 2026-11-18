import { describe, expect, it } from "vitest";

import { AutomationConnectionInput, AutomationInput, AutomationRunnerInput, connectionExpression, connectionNameOf, shownOf } from "./automations.js";

describe("connections", () => {
  it("take each kind of sign-in, and refuse what isn't one", () => {
    expect(AutomationConnectionInput.safeParse({ name: "slack-bot", piece: "@activepieces/piece-slack", value: { type: "SECRET_TEXT", secret_text: "xoxb-1" } }).success).toBe(true);
    expect(AutomationConnectionInput.safeParse({ name: "jira", piece: "@activepieces/piece-jira-cloud", value: { type: "BASIC_AUTH", username: "asha", password: "p" } }).success).toBe(true);
    expect(AutomationConnectionInput.safeParse({ name: "room-db", piece: "@activepieces/piece-postgres", value: { type: "CUSTOM_AUTH", props: { host: "postgres", port: 5432, enable_ssl: false } } }).success).toBe(true);
    expect(AutomationConnectionInput.safeParse({ name: "bad name!", piece: "@activepieces/piece-slack", value: { type: "SECRET_TEXT", secret_text: "x" } }).success).toBe(false);
    expect(AutomationConnectionInput.safeParse({ name: "x", piece: "evil", value: { type: "SECRET_TEXT", secret_text: "x" } }).success).toBe(false);
    expect(AutomationConnectionInput.safeParse({ name: "x", piece: "@activepieces/piece-slack", value: { type: "OAUTH2", access_token: "x" } }).success).toBe(false);
    expect(AutomationConnectionInput.safeParse({ name: "x", piece: "@activepieces/piece-slack", value: { type: "SECRET_TEXT", secret_text: "" } }).success).toBe(false);
  });

  it("show a user and the fields that aren't secret, never a password or key, whatever the browser says", () => {
    expect(shownOf({ type: "SECRET_TEXT", secret_text: "xoxb-1" }, ["secret_text"])).toEqual({});
    expect(shownOf({ type: "BASIC_AUTH", username: "asha", password: "p" })).toEqual({ username: "asha" });
    const props = { host: "postgres", port: 5432, user: "app", password: "hunter2", database: "app", enable_ssl: false, certificate: "-----BEGIN", api_key: "k", accessToken: "t" };
    expect(shownOf({ type: "CUSTOM_AUTH", props }, ["host", "port", "user", "password", "database", "enable_ssl", "certificate", "api_key", "accessToken", "missing"])).toEqual({ host: "postgres", port: 5432, user: "app", database: "app", enable_ssl: false });
  });

  it("are named in a step as Activepieces does", () => {
    expect(connectionExpression("room-db")).toBe("{{connections['room-db']}}");
    expect(connectionNameOf("{{connections['room-db']}}")).toBe("room-db");
    expect(connectionNameOf(' {{ connections["slack"] }} ')).toBe("slack");
    expect(connectionNameOf("{{trigger.output}}")).toBeNull();
    expect(connectionNameOf(undefined)).toBeNull();
  });

  it("are the API's to give a run: a browser's run may carry them, and the API removes them; testing one is the API's alone", () => {
    const run = AutomationInput.parse({ op: "run", path: "automations/a.flow.json", connections: { x: { piece: "@activepieces/piece-slack", value: { type: "SECRET_TEXT", secret_text: "s" } } } });
    expect(run.op === "run" && run.connections?.x?.piece).toBe("@activepieces/piece-slack");
    expect(AutomationInput.safeParse({ op: "test-connection", piece: "@activepieces/piece-slack", value: { type: "SECRET_TEXT", secret_text: "s" } }).success).toBe(false);
    expect(AutomationRunnerInput.safeParse({ op: "test-connection", piece: "@activepieces/piece-slack", value: { type: "SECRET_TEXT", secret_text: "s" } }).success).toBe(true);
  });
});
