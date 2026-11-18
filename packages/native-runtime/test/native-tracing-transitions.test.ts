import { test } from "node:test";
import assert from "node:assert/strict";
import { createNativeRootScan } from "../src/tracing/index.ts";
import {
  stackMapMagic,
  stackMapVersion,
  stackMapRegistryHeaderBytes,
  stackMapTableHeaderBytes,
} from "../src/tracing/scan.ts";
import {
  transitionFrame,
  transitionTable,
} from "../src/tracing/transitions.ts";
import {
  nativeCallbackThunkTransitionOffset,
  nativeStackMapTransitionTable,
} from "@tint/abi/host";

const registry = 8192,
  thunkCode = 16384,
  managedCode = 20480,
  table = 9216;
/** A callback's Tint frame (A, sp 256) called by a callback thunk (frame
 * pointer 512) that C called, while C was called by a may-callback call in
 * frame B (sp 1040) whose transition record is at 1024 in B's outgoing area.
 * The C frames between the thunk and the record are never read. */
function callbackStack(): Map<number, number> {
  const words = new Map<number, number>();
  const set = (address: number, value: number) => words.set(address, value);
  // Registry: the thunk range (transition table) and the managed code.
  [2, 2, 240, 0].forEach((value, at) => set(registry + at * 8, value));
  const entries = registry + stackMapRegistryHeaderBytes;
  [thunkCode, 64, transitionTable, managedCode, 64, table].forEach(
    (value, at) => set(entries + at * 8, value),
  );
  // Safepoints at return offsets 4 (in A) and 8 (in B): 48-byte frames
  // with one reference at sp + 16.
  const maps = table + stackMapTableHeaderBytes + 16;
  [stackMapMagic, stackMapVersion, 2].forEach((value, at) =>
    set(table + at * 8, value),
  );
  for (let index = 0; index < 2; index++) {
    const map = maps + index * 40;
    set(
      table + stackMapTableHeaderBytes + index * 8,
      ((map - table) / 8) * 4294967296 + 4 * (index + 1),
    );
    [48, 1, 16, 0, 0].forEach((value, at) => set(map + at * 8, value));
  }
  // The collector's record, then A's: A returns into the thunk.
  set(240, 304);
  set(248, managedCode + 4);
  set(272, 768);
  set(304, 512);
  set(312, thunkCode + 8);
  // The thunk frame: C's saved frame pointer (never followed) and the
  // transition record's address.
  set(512, 4000);
  set(512 + nativeCallbackThunkTransitionOffset, 1024);
  // The transition record: B's frame pointer and the may-callback call's
  // return address, then the rest of the record (not read by the walk).
  set(1024, 1088);
  set(1032, managedCode + 8);
  set(1056, 2048);
  // B's own record: the entry frame.
  set(1088, 1200);
  set(1096, 0);
  set(1200, 0);
  return words;
}
test("transition constants match the ABI's", () => {
  assert.equal(transitionTable, nativeStackMapTransitionTable);
});
test("stack walks cross C frames through callback thunks' transition records", () => {
  const words = callbackStack();
  const read = (address: number) => words.get(address);
  const seen: number[] = [];
  assert.equal(
    createNativeRootScan(read)(registry, (value) => {
      seen.push(value);
      return true;
    }),
    "complete",
  );
  // The callback's frame, then the may-callback caller's.
  assert.deepEqual(seen, [768, 2048]);
  // maxFrames still bounds the walk (A, the thunk, B, then B's record).
  assert.equal(
    createNativeRootScan(read)(registry, () => true, 3),
    "limit",
  );
  assert.equal(
    createNativeRootScan(read)(registry, () => true, 4),
    "complete",
  );
});
test("malformed or unreadable transition records fail closed", () => {
  const at = 512 + nativeCallbackThunkTransitionOffset;
  for (const [record, status] of [
    [undefined, "read"],
    [1032, "invalid"], // misaligned
    [512, "invalid"], // not above the thunk frame
    [0, "invalid"],
    [0.5, "invalid"],
  ] as const) {
    const words = callbackStack();
    if (record === undefined) words.delete(at);
    else words.set(at, record);
    assert.equal(
      createNativeRootScan((address) => words.get(address))(
        registry,
        () => true,
      ),
      status,
      String(record),
    );
  }
  const read = (address: number) => (address === at ? 1024 : undefined);
  assert.equal(transitionFrame(read, 512), 1024);
  assert.equal(
    transitionFrame(() => undefined, 512),
    -1,
  );
});
