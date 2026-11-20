// A flow's settings as typed (flow-settings.tsx): run from apps/runner with `pnpm exec tsx --test <this file's absolute path>`.
import assert from "node:assert/strict";
import { test } from "node:test";

import { settingOf, timezoneOf, withSetting } from "./flow-settings";
import type { Flow } from "./model";

const flow: Flow = { displayName: "Test", schemaVersion: "27", trigger: { name: "trigger", type: "PIECE_TRIGGER", displayName: "When", settings: {}, nextAction: null } };

test("a setting as typed: a whole number within its limits, empty for the default, or what's wrong", () => {
  assert.deepEqual(settingOf("timeoutSeconds", "60"), { value: 60 });
  assert.deepEqual(settingOf("timeoutSeconds", " "), { value: null });
  assert.deepEqual(settingOf("timeoutSeconds", "4"), { problem: "From 5 to 900." });
  assert.deepEqual(settingOf("timeoutSeconds", "901"), { problem: "From 5 to 900." });
  assert.deepEqual(settingOf("timeoutSeconds", "1.5"), { problem: "A whole number." });
  assert.deepEqual(settingOf("timeSavedMinutes", "0"), { value: 0 });
  assert.deepEqual(settingOf("timeSavedMinutes", "1441"), { problem: "From 0 to 1,440." });
});

test("the flow with a setting changed, and none left leaving none in the file", () => {
  const set = withSetting(flow, "timeoutSeconds", 60);
  assert.deepEqual(set.settings, { timeoutSeconds: 60 });
  const both = withSetting(set, "timeSavedMinutes", 10);
  assert.deepEqual(both.settings, { timeoutSeconds: 60, timeSavedMinutes: 10 });
  assert.deepEqual(withSetting(both, "timeoutSeconds", null).settings, { timeSavedMinutes: 10 });
  assert.equal("settings" in withSetting(set, "timeoutSeconds", null), false);
  assert.equal(flow.settings, undefined, "what it was given isn't changed");
});

test("a timezone as typed: as it's written, nothing for UTC, or what's wrong", () => {
  assert.deepEqual(timezoneOf("Asia/Kolkata"), { value: "Asia/Kolkata" });
  assert.deepEqual(timezoneOf(" europe/london "), { value: "Europe/London" });
  assert.deepEqual(timezoneOf("UTC"), { value: null });
  assert.deepEqual(timezoneOf(""), { value: null });
  assert.ok("problem" in timezoneOf("Mars/Olympus"));
  assert.ok("problem" in timezoneOf("Europe/London; rm"));
});

test("which runs are kept: only a run not kept is written", () => {
  const off = withSetting(flow, "saveSucceeded", false);
  assert.deepEqual(off.settings, { saveSucceeded: false });
  assert.equal("settings" in withSetting(off, "saveSucceeded", null), false);
  assert.deepEqual(withSetting(withSetting(off, "saveFailed", false), "timezone", "Asia/Kolkata").settings, { saveSucceeded: false, saveFailed: false, timezone: "Asia/Kolkata" });
});

test("which flows may call it: a list kept even when empty (none may), and taken out for any", () => {
  const none = withSetting(flow, "callers", []);
  assert.deepEqual(none.settings, { callers: [] });
  assert.deepEqual(withSetting(none, "callers", ["flow_a"]).settings, { callers: ["flow_a"] });
  assert.equal("settings" in withSetting(none, "callers", null), false);
});

test("how many runs it keeps: from 1 to 500, empty for 50", () => {
  assert.deepEqual(settingOf("keepRuns", "3"), { value: 3 });
  assert.deepEqual(settingOf("keepRuns", "0"), { problem: "From 1 to 500." });
  assert.deepEqual(settingOf("keepRuns", "501"), { problem: "From 1 to 500." });
  assert.deepEqual(settingOf("keepRuns", ""), { value: null });
  assert.deepEqual(withSetting(flow, "keepRuns", 3).settings, { keepRuns: 3 });
});
