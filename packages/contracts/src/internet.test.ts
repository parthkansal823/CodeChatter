import { describe, expect, it } from "vitest";

import { AutomationInternetInput, AutomationRunnerInput, hostProblem, internetHostsOf, PIECE_HOSTS } from "./automations.js";

describe("the internet for a room's automations", () => {
  it("takes public host names only", () => {
    expect(hostProblem("api.github.com")).toBeNull();
    expect(hostProblem("Your-Team.Atlassian.net.")).toBeNull();
    expect(hostProblem("10.0.0.1")).toMatch(/not an address/);
    expect(hostProblem("example.com:8443")).toMatch(/not an address or a port/);
    expect(hostProblem("example.com/path")).toMatch(/no path or wildcard/);
    expect(hostProblem("*.atlassian.net")).toMatch(/no path or wildcard/);
    expect(hostProblem("printer.local")).toMatch(/private name/);
    expect(hostProblem("db.internal")).toMatch(/private name/);
    expect(hostProblem("localhost")).not.toBeNull();
    expect(hostProblem("nodot")).toMatch(/isn't a host's name/);
  });

  it("comes to every host of the services turned on and the ones named, once each", () => {
    expect(internetHostsOf(["@activepieces/piece-slack"], ["Feeds.Example.com", "slack.com"])).toEqual(["api.slack.com", "feeds.example.com", "files.slack.com", "hooks.slack.com", "slack.com"]);
    expect(Object.values(PIECE_HOSTS).every((entry) => entry.hosts.every((host) => hostProblem(host) === null))).toBe(true);
  });

  it("refuses what isn't a service or a host, and keeps hosts lower case", () => {
    expect(AutomationInternetInput.parse({ services: ["@activepieces/piece-github"], hosts: ["Feeds.Example.com"] })).toEqual({ services: ["@activepieces/piece-github"], hosts: ["feeds.example.com"] });
    expect(AutomationInternetInput.safeParse({ services: ["@activepieces/piece-csv"], hosts: [] }).success).toBe(false);
    expect(AutomationInternetInput.safeParse({ services: [], hosts: ["169.254.169.254"] }).success).toBe(false);
    expect(AutomationInternetInput.parse({})).toEqual({ services: [], hosts: [] });
  });

  it("goes to the runner only from the API, with each run", () => {
    expect(AutomationRunnerInput.safeParse({ op: "run", path: "automations/a.flow.json", internet: ["api.github.com"] }).success).toBe(true);
  });
});
