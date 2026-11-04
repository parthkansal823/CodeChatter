// node:test, run with tsx (see CLAUDE.md "Unit tests").
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as Y from "yjs";

import { advanceIfEnded, clock, pauseTimer, readTimer, remainingAt, resetTimer, setLengths, skipTimer, startTimer } from "./focus-timer";

const timer = () => new Y.Doc().getMap<unknown>("timer");
const MIN = 60_000;

describe("focus timer", () => {
  it("starts at 25 minutes of focus, stopped", () => {
    const state = readTimer(timer());
    assert.deepEqual([state.phase, state.running, state.remainingMs], ["focus", false, 25 * MIN]);
    assert.equal(clock(state.remainingMs), "25:00");
    assert.equal(clock(59_001), "01:00");
  });

  it("counts down while it runs, and keeps what's left when paused", () => {
    const map = timer();
    startTimer(map, "ana", 0);
    assert.equal(remainingAt(readTimer(map), 10 * MIN), 15 * MIN);
    pauseTimer(map, "ben", 10 * MIN);
    const paused = readTimer(map);
    assert.deepEqual([paused.running, paused.remainingMs, paused.by], [false, 15 * MIN, "ben"]);
    assert.equal(remainingAt(paused, 99 * MIN), 15 * MIN);
    startTimer(map, "ana", 20 * MIN);
    assert.equal(readTimer(map).endsAt, 35 * MIN);
  });

  it("moves from focus to a break when the stretch ends, once", () => {
    const map = timer();
    startTimer(map, "ana", 0);
    const end = readTimer(map).endsAt!;
    assert.equal(advanceIfEnded(map, end - 1, end), null);
    assert.equal(advanceIfEnded(map, end + 500, end), "focus");
    // A second browser that saw the same end doesn't move it again.
    assert.equal(advanceIfEnded(map, end + 600, end), null);
    const state = readTimer(map);
    assert.deepEqual([state.phase, state.running, state.endsAt], ["break", true, end + 5 * MIN]);
  });

  it("skips to the other stretch, and resets to focus", () => {
    const map = timer();
    skipTimer(map, "ana", 0);
    assert.deepEqual([readTimer(map).phase, readTimer(map).remainingMs, readTimer(map).running], ["break", 5 * MIN, false]);
    startTimer(map, "ana", 0);
    resetTimer(map, "ben");
    assert.deepEqual([readTimer(map).phase, readTimer(map).remainingMs, readTimer(map).running], ["focus", 25 * MIN, false]);
  });

  it("takes only the offered lengths, and a fresh stretch takes the new one", () => {
    const map = timer();
    setLengths(map, { focusMinutes: 50, breakMinutes: 10 }, "ana");
    assert.deepEqual([readTimer(map).focusMinutes, readTimer(map).breakMinutes, readTimer(map).remainingMs], [50, 10, 50 * MIN]);
    setLengths(map, { focusMinutes: 33 }, "ana");
    assert.equal(readTimer(map).focusMinutes, 50);
    // A stretch already under way keeps its time.
    startTimer(map, "ana", 0);
    pauseTimer(map, "ana", MIN);
    setLengths(map, { focusMinutes: 15 }, "ana");
    assert.deepEqual([readTimer(map).focusMinutes, readTimer(map).remainingMs], [15, 49 * MIN]);
  });
});
