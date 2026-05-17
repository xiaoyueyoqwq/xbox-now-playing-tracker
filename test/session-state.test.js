import assert from "node:assert/strict";
import test from "node:test";
import { shouldContinuePlaySession } from "../src/session-state.js";

const graceMs = 30 * 60 * 1000;

test("session continues when the game was observed recently and never marked away", () => {
  assert.equal(shouldContinuePlaySession({
    startedAt: "2026-05-17T10:00:00.000Z",
    lastObservedAt: "2026-05-17T10:20:00.000Z",
    awayObservedAt: "",
  }, "2026-05-17T10:45:00.000Z", { graceMs }), true);
});

test("session does not continue after a no-observation gap beyond grace", () => {
  assert.equal(shouldContinuePlaySession({
    startedAt: "2026-05-17T10:00:00.000Z",
    lastObservedAt: "2026-05-17T10:20:00.000Z",
    awayObservedAt: "",
  }, "2026-05-17T10:51:00.000Z", { graceMs }), false);
});

test("recent away observation still continues inside grace window", () => {
  assert.equal(shouldContinuePlaySession({
    startedAt: "2026-05-17T10:00:00.000Z",
    lastObservedAt: "2026-05-17T10:20:00.000Z",
    awayObservedAt: "2026-05-17T10:30:00.000Z",
  }, "2026-05-17T10:45:00.000Z", { graceMs }), true);
});

test("fresh away observation cannot revive a stale last observation", () => {
  assert.equal(shouldContinuePlaySession({
    startedAt: "2026-05-17T10:00:00.000Z",
    lastObservedAt: "2026-05-17T10:20:00.000Z",
    awayObservedAt: "2026-05-17T11:29:00.000Z",
  }, "2026-05-17T11:30:00.000Z", { graceMs }), false);
});
