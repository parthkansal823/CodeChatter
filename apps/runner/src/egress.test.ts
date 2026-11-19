import { describe, expect, it } from "vitest";

import { EGRESS_HOSTS, LABEL_BY, LABEL_HOSTS, LABEL_INSTALLS, LABEL_UNTIL, planOf, ProxyBase, proxyEnv, SERVICES_MS, type ProxyPlan } from "./egress.js";
import type { RoomSandbox } from "./sandbox.js";

const NOW = 1_800_000_000_000;

describe("a room's proxy plan", () => {
  it("starts the proxy with registries until installs end, and the automations' hosts for as long as it runs", () => {
    expect(proxyEnv({ installsUntil: NOW + 60_000, by: "Asha", hosts: ["api.github.com"], servicesUntil: NOW + SERVICES_MS })).toEqual({
      env: { EGRESS_ALLOW: EGRESS_HOSTS, EGRESS_ALWAYS: "api.github.com", EGRESS_UNTIL: String(NOW + 60_000) },
      until: NOW + SERVICES_MS,
    });
    expect(proxyEnv({ installsUntil: null, by: "", hosts: ["slack.com"], servicesUntil: NOW + 1000 })).toEqual({ env: { EGRESS_ALLOW: "", EGRESS_ALWAYS: "slack.com", EGRESS_UNTIL: "" }, until: NOW + 1000 });
  });

  it("reads back what's left of a proxy, a proxy from before the automations' hosts too", () => {
    expect(planOf({ [LABEL_UNTIL]: String(NOW + 5000), [LABEL_INSTALLS]: String(NOW + 5000), [LABEL_HOSTS]: "a.com,b.com", [LABEL_BY]: "Asha" }, NOW)).toEqual({ installsUntil: NOW + 5000, by: "Asha", hosts: ["a.com", "b.com"], servicesUntil: NOW + 5000 });
    // Installs over, hosts still on.
    expect(planOf({ [LABEL_UNTIL]: String(NOW + 9000), [LABEL_INSTALLS]: String(NOW - 1), [LABEL_HOSTS]: "a.com" }, NOW)).toEqual({ installsUntil: null, by: "", hosts: ["a.com"], servicesUntil: NOW + 9000 });
    // An older proxy: LABEL_UNTIL was the end of installs.
    expect(planOf({ [LABEL_UNTIL]: String(NOW + 9000), [LABEL_BY]: "Ben" }, NOW)).toEqual({ installsUntil: NOW + 9000, by: "Ben", hosts: [], servicesUntil: null });
  });
});

/** A proxy that only remembers what it was asked to do. */
class Recorded extends ProxyBase {
  plan: ProxyPlan | null = null;
  starts = 0;
  protected async current() {
    return this.plan;
  }
  protected async start(_roomId: string, plan: ProxyPlan) {
    this.starts += 1;
    this.plan = plan;
  }
  protected async remove() {
    this.plan = null;
  }
}
const sandbox = { roomId: "ABC123" } as RoomSandbox;

describe("installs and the automations' hosts, through one proxy", () => {
  it("keeps the hosts when installs are allowed and when they stop", async () => {
    const proxy = new Recorded();
    await proxy.services(sandbox, ["api.github.com", "api.github.com", "slack.com"]);
    expect(proxy.plan).toMatchObject({ installsUntil: null, hosts: ["api.github.com", "slack.com"] });
    await proxy.allow(sandbox, 60, "Asha");
    expect(proxy.plan).toMatchObject({ by: "Asha", hosts: ["api.github.com", "slack.com"] });
    expect(proxy.plan!.installsUntil).toBeGreaterThan(Date.now());
    expect(await proxy.status("ABC123")).toMatchObject({ by: "Asha" });
    await proxy.stop("ABC123");
    expect(proxy.plan).toMatchObject({ installsUntil: null, hosts: ["api.github.com", "slack.com"] });
    expect(await proxy.status("ABC123")).toBeNull();
  });

  it("doesn't restart for the same hosts, and goes when there are none and no installs", async () => {
    const proxy = new Recorded();
    await proxy.services(sandbox, ["a.com"]);
    await proxy.services(sandbox, ["a.com"]);
    expect(proxy.starts).toBe(1);
    await proxy.services(sandbox, ["a.com", "b.com"]);
    expect(proxy.starts).toBe(2);
    await proxy.services(sandbox, []);
    expect(proxy.plan).toBeNull();
  });

  it("with installs on, turning the hosts off keeps installs", async () => {
    const proxy = new Recorded();
    await proxy.allow(sandbox, 60, "Asha");
    await proxy.services(sandbox, ["a.com"]);
    await proxy.services(sandbox, []);
    expect(proxy.plan).toMatchObject({ hosts: [], servicesUntil: null, by: "Asha" });
    expect(proxy.plan!.installsUntil).toBeGreaterThan(Date.now());
  });
});
