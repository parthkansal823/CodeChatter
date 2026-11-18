/** Test instance/organisation authority separation, self/last-admin safety, raw-plugin denial and exact safe operational metric parsing. */
import { describe, expect, it } from "vitest";

import { isRawAdminPath } from "./admin-auth-boundary.js";
import { readPrometheusGauge } from "./admin-health.service.js";
import { assertRoleChange, isBanned, isInstanceAdmin } from "./admin-policy.js";

describe("instance administrator authority", () => {
  it("matches the installed plugin's exact comma-separated admin role", () => {
    for (const role of ["admin", "user,admin", "admin,user"]) expect(isInstanceAdmin(role)).toBe(true);
    for (const role of [null, "user", "owner", "organization-admin", " admin ", "Admin"]) expect(isInstanceAdmin(role)).toBe(false);
  });

  it("uses active ban expiry rather than a stale expired flag", () => {
    const now = new Date("2026-11-17T00:00:00Z");
    expect(isBanned({ banned: true, banExpires: null }, now)).toBe(true);
    expect(isBanned({ banned: true, banExpires: new Date("2026-11-18") }, now)).toBe(true);
    expect(isBanned({ banned: true, banExpires: new Date("2026-11-16") }, now)).toBe(false);
  });

  it("forbids console or API demotion of the last usable administrator", () => {
    for (const actorId of [null, "last"]) expect(() => assertRoleChange({ actorId, targetId: "last", targetIsAdmin: true, targetIsUsable: true, nextRole: "user", usableAdmins: 1 })).toThrow("Keep at least one");
  });

  it("forbids self-demotion even when another administrator exists", () => {
    expect(() => assertRoleChange({ actorId: "a", targetId: "a", targetIsAdmin: true, targetIsUsable: true, nextRole: "user", usableAdmins: 2 })).toThrow("own instance admin rights");
  });

  it("permits removing another admin and an unusable banned admin without removing the last usable one", () => {
    expect(() => assertRoleChange({ actorId: "a", targetId: "b", targetIsAdmin: true, targetIsUsable: true, nextRole: "user", usableAdmins: 2 })).not.toThrow();
    expect(() => assertRoleChange({ actorId: null, targetId: "b", targetIsAdmin: true, targetIsUsable: false, nextRole: "user", usableAdmins: 1 })).not.toThrow();
    expect(() => assertRoleChange({ actorId: null, targetId: "first", targetIsAdmin: false, targetIsUsable: true, nextRole: "admin", usableAdmins: 0 })).not.toThrow();
  });
});

describe("raw plugin HTTP boundary", () => {
  it("closes the entire namespace including encoded paths and sensitive endpoints", () => {
    for (const path of ["/api/auth/admin/list-users", "/api/auth/admin/set-role", "/api/auth/admin/admin-update-user", "/api/auth/admin/impersonate-user", "/api/auth/admin/list-user-sessions", "/api/auth/%61dmin/set-role", "/api/auth/admin%2fset-role", "/api/auth/%2561dmin/set-role", "/api/auth/ADMIN/set-role", "/api//auth//admin//set-role"]) expect(isRawAdminPath(path)).toBe(true);
  });
  it("preserves ordinary sign-in, factor, account and organisation endpoints", () => {
    for (const path of ["/api/auth/sign-in/email", "/api/auth/two-factor/verify-totp", "/api/auth/organization/get-full-organization", "/api/auth/get-session", "/api/admin/users", "/api/auth/administrator"]) expect(isRawAdminPath(path)).toBe(false);
  });
});

describe("existing Prometheus gauges", () => {
  it("reads the exact exposed names without confusing prefixes or sample timestamps", () => {
    const text = '# HELP codechatter_runner_sandboxes value\ncodechatter_runner_sandboxes_total 99\ncodechatter_runner_sandboxes{service="runner"} 3 123456\ncodechatter_collab_documents_loaded{service="collab"} 7\ncodechatter_collab_connections{service="collab"} 2\n';
    expect(readPrometheusGauge(text, "codechatter_runner_sandboxes")).toBe(3);
    expect(readPrometheusGauge(text, "codechatter_collab_documents_loaded")).toBe(7);
    expect(readPrometheusGauge(text, "codechatter_collab_connections")).toBe(2);
  });
  it("keeps missing, NaN and invalid resource values unknown rather than zero", () => {
    for (const value of ["", "codechatter_runner_sandboxes NaN", "codechatter_runner_sandboxes +Inf", "codechatter_runner_sandboxes -1"]) expect(readPrometheusGauge(value, "codechatter_runner_sandboxes")).toBeNull();
    expect(readPrometheusGauge("codechatter_runner_sandboxes 0\n", "codechatter_runner_sandboxes")).toBe(0);
  });
});
