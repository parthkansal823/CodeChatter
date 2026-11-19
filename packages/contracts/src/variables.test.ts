import { describe, expect, it } from "vitest";

import { AutomationVariableInput, MOST_VARIABLE_CHARACTERS, RunVariables, VariableName, variableExpression } from "./variables.js";

describe("a room's variables for its automations", () => {
  it("names are what {{variables.NAME}} can read", () => {
    for (const name of ["BASE_URL", "env", "_private", "x1"]) expect(VariableName.safeParse(name).success).toBe(true);
    for (const name of ["", "1st", "has space", "dot.ted", "dash-ed", "a".repeat(65), "naïve"]) expect(VariableName.safeParse(name).success).toBe(false);
  });

  it("values are text, up to a limit", () => {
    expect(AutomationVariableInput.safeParse({ value: "" }).success).toBe(true);
    expect(AutomationVariableInput.safeParse({ value: "x".repeat(MOST_VARIABLE_CHARACTERS) }).success).toBe(true);
    expect(AutomationVariableInput.safeParse({ value: "x".repeat(MOST_VARIABLE_CHARACTERS + 1) }).success).toBe(false);
    expect(AutomationVariableInput.safeParse({ value: 3 }).success).toBe(false);
  });

  it("a run's are names to text, and may be left out", () => {
    expect(RunVariables.safeParse({ BASE_URL: "https://example.com" }).success).toBe(true);
    expect(RunVariables.safeParse(undefined).success).toBe(true);
    expect(RunVariables.safeParse({ "not a name": "x" }).success).toBe(false);
    expect(RunVariables.safeParse({ COUNT: 3 }).success).toBe(false);
  });

  it("reads as Activepieces' expression", () => {
    expect(variableExpression("BASE_URL")).toBe("{{variables.BASE_URL}}");
  });
});
