/** Exercise OSV batching, cache isolation, pagination and upstream failures without using the internet. */
import type { DependencyPackage } from "@codechatter/contracts";
import { BadGatewayException, ForbiddenException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoomsService } from "../rooms/rooms.service.js";
import { DependenciesController } from "./dependencies.controller.js";
import { DependenciesService } from "./dependencies.service.js";

const pkg: DependencyPackage = { ecosystem: "npm", name: "lodash", version: "4.17.20" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const advisory = (id = "GHSA-test-1234", extra: Record<string, unknown> = {}) => ({
  id, summary: "A known vulnerability", aliases: ["CVE-2026-1234"], database_specific: { severity: "HIGH" },
  affected: [{ package: { ecosystem: "npm", name: "lodash" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "4.17.21" }] }] }], ...extra,
});
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("OSV dependency checks", () => {
  it("keeps unversioned packages unchecked without calling OSV", async () => {
    const unchecked = { ...pkg, version: null };
    expect(await new DependenciesService().check([unchecked])).toEqual({ results: [], unchecked: [unchecked] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches details, normalizes severity, chooses the matching package fix and caches both responses", async () => {
    fetchMock.mockResolvedValueOnce(json({ results: [{ vulns: [{ id: "GHSA-test-1234" }] }] }))
      .mockResolvedValueOnce(json(advisory("GHSA-test-1234", { affected: [
        { package: { ecosystem: "PyPI", name: "lodash" }, ranges: [{ type: "ECOSYSTEM", events: [{ fixed: "0.1" }] }] },
        { package: { ecosystem: "npm", name: "lodash" }, ranges: [{ type: "SEMVER", events: [{ fixed: "10.0.0" }, { fixed: "4.17.21" }] }] },
      ] })));
    const service = new DependenciesService();
    const first = await service.check([pkg]);
    expect(first.results[0]).toMatchObject({ ...pkg, vulns: [{ id: "GHSA-test-1234", severity: "high", fixed: "4.17.21", url: "https://osv.dev/vulnerability/GHSA-test-1234" }] });
    expect(await service.check([pkg])).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.osv.dev/v1/querybatch");
    expect(JSON.parse(init!.body as string)).toEqual({ queries: [{ package: { ecosystem: "npm", name: "lodash" }, version: "4.17.20" }] });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.redirect).toBe("error");
  });

  it("chunks 1001 unique package queries and returns every package", async () => {
    fetchMock.mockImplementation(async (_url, init) => json({ results: JSON.parse(init!.body as string).queries.map(() => ({})) }));
    const packages = Array.from({ length: 1001 }, (_, i) => ({ ...pkg, name: `package-${i}` }));
    const result = await new DependenciesService().check(packages);
    expect(result.results).toHaveLength(1001);
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(init!.body as string).queries.length)).toEqual([1000, 1]);
  });

  it("follows per-query pagination and deduplicates repeated advisory IDs", async () => {
    fetchMock.mockResolvedValueOnce(json({ results: [{ vulns: [{ id: "GHSA-first" }], next_page_token: "page-2" }, {}] }))
      .mockResolvedValueOnce(json({ results: [{ vulns: [{ id: "GHSA-first" }, { id: "GHSA-second" }] }] }))
      .mockImplementation(async (url) => json(advisory(String(url).split("/").at(-1)!)));
    const result = await new DependenciesService().check([pkg, { ...pkg, name: "other" }]);
    expect(result.results[0]?.vulns.map((vuln) => vuln.id)).toEqual(["GHSA-first", "GHSA-second"]);
    expect(result.results[1]?.vulns).toEqual([]);
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string).queries).toEqual([{ package: { name: "lodash", ecosystem: "npm" }, version: "4.17.20", page_token: "page-2" }]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("coalesces simultaneous room checks for the same coordinates", async () => {
    let release: ((response: Response) => void) | undefined;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }));
    const service = new DependenciesService();
    const a = service.check([pkg]);
    const b = service.check([pkg]);
    release!(json({ results: [{}] }));
    expect(await a).toEqual(await b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("expires batch and detail answers after six hours", async () => {
    const time = vi.spyOn(Date, "now").mockReturnValue(0);
    fetchMock.mockImplementation(async (url) => String(url).endsWith("querybatch")
      ? json({ results: [{ vulns: [{ id: "GHSA-test-1234" }] }] }) : json(advisory()));
    const service = new DependenciesService();
    await service.check([pkg]);
    time.mockReturnValue(6 * 60 * 60_000 - 1);
    await service.check([pkg]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    time.mockReturnValue(6 * 60 * 60_000);
    await service.check([pkg]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does not cache query failures and maps bad or unreachable responses to a plain 502", async () => {
    const service = new DependenciesService();
    fetchMock.mockRejectedValueOnce(new Error("DNS error"));
    await expect(service.check([pkg])).rejects.toMatchObject({ status: 502, message: "Couldn't reach the vulnerability database (osv.dev). Try again in a minute." });
    fetchMock.mockResolvedValueOnce(json({ results: [{}] }));
    expect((await service.check([pkg])).results[0]?.vulns).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const body of [{ results: [] }, { results: [{ error: { code: 500 } }] }]) {
      fetchMock.mockResolvedValueOnce(json(body));
      await expect(new DependenciesService().check([pkg])).rejects.toBeInstanceOf(BadGatewayException);
    }
    fetchMock.mockResolvedValueOnce(json({}, 503));
    await expect(new DependenciesService().check([pkg])).rejects.toBeInstanceOf(BadGatewayException);
  });

  it("retries a failed detail fetch without repeating the cached batch query", async () => {
    fetchMock.mockResolvedValueOnce(json({ results: [{ vulns: [{ id: "GHSA-test-1234" }] }] }))
      .mockRejectedValueOnce(new DOMException("Timed out", "TimeoutError"));
    const service = new DependenciesService();
    await expect(service.check([pkg])).rejects.toBeInstanceOf(BadGatewayException);
    fetchMock.mockResolvedValueOnce(json(advisory()));
    expect((await service.check([pkg])).results[0]?.vulns).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("limits globally concurrent details to eight across different room checks", async () => {
    let active = 0;
    let maximum = 0;
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url).endsWith("querybatch")) {
        const name = JSON.parse(init!.body as string).queries[0].package.name;
        return json({ results: [{ vulns: Array.from({ length: 10 }, (_, i) => ({ id: `GHSA-${name}-${i}` })) }] });
      }
      active++; maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return json(advisory(String(url).split("/").at(-1)!));
    });
    const service = new DependenciesService();
    await Promise.all([service.check([pkg]), service.check([{ ...pkg, name: "second" }])]);
    expect(maximum).toBe(8);
  });

  it("omits withdrawn records and falls back to package-level CVSS when a severity label is absent", async () => {
    fetchMock.mockResolvedValueOnce(json({ results: [{ vulns: [{ id: "GHSA-withdrawn" }, { id: "GHSA-cvss" }] }] }))
      .mockResolvedValueOnce(json(advisory("GHSA-withdrawn", { withdrawn: "2026-01-01T00:00:00Z" })))
      .mockResolvedValueOnce(json(advisory("GHSA-cvss", {
        database_specific: {}, affected: [{ package: { ecosystem: "npm", name: "lodash" }, severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" }] }],
      })));
    const result = await new DependenciesService().check([pkg]);
    expect(result.results[0]?.vulns).toMatchObject([{ id: "GHSA-cvss", severity: "critical", fixed: null }]);
  });

  it("normalizes Python matching without changing returned package coordinates", async () => {
    fetchMock.mockResolvedValueOnce(json({ results: [{ vulns: [{ id: "PYSEC-test" }] }] }))
      .mockResolvedValueOnce(json(advisory("PYSEC-test", { database_specific: { severity: "MEDIUM" }, affected: [
        { package: { ecosystem: "PyPI", name: "some-project" }, ranges: [{ type: "ECOSYSTEM", events: [{ fixed: "2.0" }, { fixed: "1.10" }] }] },
      ] })));
    const python: DependencyPackage = { ecosystem: "PyPI", name: "Some_Project", version: "1.0" };
    const service = new DependenciesService();
    expect((await service.check([python])).results[0]).toMatchObject({ ...python, vulns: [{ severity: "moderate", fixed: "1.10" }] });
    await service.check([{ ...python, name: "some.project" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses repeated page tokens instead of returning a partial clean answer", async () => {
    fetchMock.mockResolvedValue(json({ results: [{ next_page_token: "same-token" }] }));
    await expect(new DependenciesService().check([pkg])).rejects.toBeInstanceOf(BadGatewayException);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("dependency room authorization", () => {
  it("requires room.view before any OSV work and preserves permission failures", async () => {
    const require = vi.fn().mockRejectedValue(new ForbiddenException());
    const check = vi.fn();
    const controller = new DependenciesController({ require } as unknown as RoomsService, { check } as unknown as DependenciesService);
    const session = { user: { id: "person" } } as Parameters<DependenciesController["check"]>[0];
    await expect(controller.check(session, "E2ETST", { packages: [pkg] })).rejects.toBeInstanceOf(ForbiddenException);
    expect(require).toHaveBeenCalledWith("E2ETST", "person", "room.view");
    expect(check).not.toHaveBeenCalled();
  });
});
