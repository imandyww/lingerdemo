import { describe, expect, it } from "vitest";
import { TurnGate } from "./turn-gate";

describe("TurnGate", () => {
  it("rejects stale turns, other sessions, duplicates, and out-of-order sequences", () => {
    const gate = new TurnGate();
    gate.start("session-a", 3);
    expect(gate.accept({ sessionId: "session-a", turnId: 3, sequence: 1 })).toBe(true);
    expect(gate.accept({ sessionId: "session-a", turnId: 3, sequence: 1 })).toBe(false);
    expect(gate.accept({ sessionId: "session-a", turnId: 2, sequence: 2 })).toBe(false);
    expect(gate.accept({ sessionId: "session-b", turnId: 3, sequence: 3 })).toBe(false);
    expect(gate.droppedEvents).toBe(3);
  });

  it("advances immediately on cancellation so late output cannot leak", () => {
    const gate = new TurnGate();
    gate.start("session-a", 8);
    expect(gate.cancelAndAdvance()).toBe(9);
    expect(gate.accept({ sessionId: "session-a", turnId: 8, sequence: 10 })).toBe(false);
    expect(gate.accept({ sessionId: "session-a", turnId: 9, sequence: 1 })).toBe(true);
  });
});
