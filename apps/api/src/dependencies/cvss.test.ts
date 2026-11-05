/** Check known CVSS vectors and reject malformed scores instead of inventing severity. */
import { describe, expect, it } from "vitest";
import { cvssBaseScore, scoreSeverity } from "./cvss.js";

describe("CVSS v3 base score", () => {
  it("matches the required critical and low vectors", () => {
    expect(cvssBaseScore("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H")).toBe(9.8);
    expect(cvssBaseScore("CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:L/I:N/A:N")).toBe(3.1);
    expect(scoreSeverity(9.8)).toBe("critical");
    expect(scoreSeverity(3.1)).toBe("low");
  });
  it("handles changed scope, privileges, no impact and reordered metrics", () => {
    expect(cvssBaseScore("CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:H")).toBe(9.9);
    expect(cvssBaseScore("CVSS:3.0/A:N/I:N/C:N/S:U/UI:N/PR:N/AC:L/AV:N")).toBe(0);
    expect(cvssBaseScore("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H/E:X")).toBe(9.8);
  });
  it("rejects incomplete, duplicate, unsupported and invalid metrics", () => {
    for (const vector of ["", "CVSS:4.0/AV:N", "CVSS:3.1/AV:N", "CVSS:3.1/AV:Z/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H/AV:N"]) expect(cvssBaseScore(vector)).toBeNull();
  });
  it("maps all severity thresholds", () => {
    expect([null, 0, 3.9, 4, 6.9, 7, 8.9, 9, 10].map(scoreSeverity)).toEqual(["unknown", "low", "low", "moderate", "moderate", "high", "high", "critical", "critical"]);
  });
});
