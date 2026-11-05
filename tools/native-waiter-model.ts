/** Deterministic protocol model, not native scheduling/ABI evidence. */
import assert from "node:assert/strict";
type State = "idle" | "waiting" | "notified" | "timed-out" | "aborted";
export class WaiterModel {
  readonly states: State[] = ["idle", "idle"];
  readonly keys: (
    | { block: number; offset: number; width: number; sequence: number }
    | undefined
  )[] = [];
  locks = 0;
  parks = 0;
  signals = 0;
  private sequence = 0;
  wait(
    slot: number,
    block: number,
    offset: number,
    width: 4 | 8,
    expected: number,
    timeout: number,
  ) {
    this.locks++;
    assert.notEqual(this.states[slot], "waiting");
    if (expected !== 0) return "not-equal";
    this.states[slot] = "waiting";
    this.keys[slot] = { block, offset, width, sequence: ++this.sequence };
    this.parks++;
    if (timeout === 0) {
      this.states[slot] = "timed-out";
      return "timed-out";
    }
    return "pending";
  }
  notify(block: number, offset: number, width: 4 | 8, count: number) {
    this.locks++;
    assert.ok(width === 4 || width === 8);
    let n = 0;
    const selected = [0, 1]
      .filter(
        (i) =>
          this.states[i] === "waiting" &&
          this.keys[i]?.block === block &&
          this.keys[i]?.offset === offset,
      )
      .sort((a, b) => this.keys[a]!.sequence - this.keys[b]!.sequence);
    for (const slot of selected) {
      if (n >= count) break;
      this.states[slot] = "notified";
      this.signals++;
      n++;
    }
    return n;
  }
  timeout(slot: number) {
    this.locks++;
    if (this.states[slot] !== "waiting") return false;
    this.states[slot] = "timed-out";
    return true;
  }
  spurious(slot: number) {
    this.locks++;
    assert.equal(this.states[slot], "waiting");
    this.parks++;
  }
  abort() {
    this.locks++;
    for (let i = 0; i < 2; i++)
      if (this.states[i] === "waiting") this.states[i] = "aborted";
  }
}
