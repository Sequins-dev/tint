// The allocation limit may be lowered below an in-flight top at any time: a
// debugger arming allocation sampling (`tint-heap arm`) writes the limit while
// the program is stopped wherever a pause landed, possibly inside an inline
// allocation that has passed its limit check but not yet stored its new top.
// The next allocation must then take the slow path. (A fast path that
// compared `size > limit - top` wrapped once the store made top exceed the
// limit, and bump-allocated past the nursery to the end of the managed region,
// faulting on the stack guard beyond it.)
//
// Each fixture stops at the instruction after an inline allocation's limit
// branch, lowers the limit to the young top + 1 there, and requires the next
// allocation to reach the slow-path thunk with the top still inside its
// space, then the program to finish with 42.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { fixtureSource } from "./heap-tools-fixture.ts";
import { lldb } from "./heap-snapshot/debuggers.ts";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import { testNativeLaunch } from "./gate/native-launch-test.ts";

const thunk = "__tint_allocation_sample_thunk";
/** The `{value, next}` allocation in the fixture's makeChain loop. */
const chainLine =
  fixtureSource
    .split("\n")
    .findIndex((line) => line.includes("node = { value: i, next: node }")) + 1;
const available =
  process.arch === "arm64" &&
  spawnSync("lldb", ["--version"], { encoding: "utf8" }).status === 0;

/** Builds the heap-tools fixture as a debug image for the generational runtime. */
function build(name: string): string {
  const saved = {
    debug: process.env.TINT_DEBUG_SYMBOLS,
    only: process.env.TINT_BUILD_ONLY,
  };
  process.env.TINT_DEBUG_SYMBOLS = "1";
  process.env.TINT_BUILD_ONLY = "1";
  try {
    return verifyHostedFixture(fixtureSource, name, [], [], [], [], {
      managedBytes: 16777216,
      allocationCapacity: 1048576,
      runtimeEntry: "initializeGenerationalRuntime",
    });
  } finally {
    for (const [key, value] of [
      ["TINT_DEBUG_SYMBOLS", saved.debug],
      ["TINT_BUILD_ONLY", saved.only],
    ] as const)
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
}

/** Python run in LLDB: `script exec(...)` of a multi-line program. */
function python(code: string): string {
  return "script exec(" + JSON.stringify(code) + ")";
}

/** From the stop at the chain line, a breakpoint on the instruction after
 * the next inline allocation's limit branch: there the limit check has passed
 * and the new top (x11 + size) is not yet stored. x12 holds the allocation
 * state (context +56), x11 the top the allocation read. */
const breakInFlight = python(`
t = lldb.target
pc = lldb.thread.GetFrameAtIndex(0).GetPC()
insts = t.ReadInstructions(lldb.SBAddress(pc, t), 400)
state = False
found = None
for i in range(insts.GetSize() - 1):
    ins = insts.GetInstructionAtIndex(i)
    m = ins.GetMnemonic(t)
    o = ins.GetOperands(t).replace(' ', '')
    if not state and m == 'ldr' and o.startswith('x12,[x10,#0x38]'):
        state = True
    elif state and m == 'b.hi':
        found = insts.GetInstructionAtIndex(i + 1).GetAddress().GetLoadAddress(t)
        break
assert found is not None, 'no inline allocation fast path after the chain line'
t.BreakpointCreateByAddress(found)
print('IN-FLIGHT 0x%x' % found)
`);

/** Words of the allocation state (x12) at the current stop. */
const stateWords = `
import struct
frame = lldb.thread.GetFrameAtIndex(0)
error = lldb.SBError()
def word(address):
    return struct.unpack('<I', lldb.process.ReadMemory(address, 4, error))[0]
`;

function assertAt(symbol: string): string {
  return lldb.python(
    "assert " +
      lldb.pcExpression +
      " == " +
      lldb.symbolExpression(symbol) +
      ", ('not at the slow path', lldb.process.GetState(), " +
      lldb.functionExpression +
      ", lldb.thread.GetStopDescription(200))",
  );
}

testNativeLaunch(
  "a sampling limit armed below an in-flight young top sends the next allocation to the slow path",
  { skip: !available && "needs LLDB on arm64", timeout: 300000 },
  async (onAdmitted) => {
    const image = build("heap-arm-inflight-generational");
    onAdmitted();
    try {
      const output = lldb.run(image, [
        lldb.breakAtLine("fixture", chainLine),
        lldb.launch,
        lldb.python("assert " + lldb.stoppedExpression),
        lldb.deleteBreakpoints,
        breakInFlight,
        lldb.resume,
        python(
          stateWords +
            "print('BEFORE top=%d limit=%d' % (frame.FindRegister('x11').GetValueAsUnsigned(), word(frame.FindRegister('x12').GetValueAsUnsigned() + 4)))",
        ),
        // limit = young top (as stored, before this allocation's) + 1.
        "tint-heap arm 1",
        lldb.deleteBreakpoints,
        lldb.breakAtSymbol(thunk),
        lldb.resume,
        assertAt(thunk),
        "tint-heap info --json",
        "tint-heap verify --json",
        lldb.deleteBreakpoints,
        "tint-heap arm 0",
        lldb.resume,
        lldb.assertExit(42),
      ]);
      assert.match(output, /IN-FLIGHT 0x[0-9a-f]+/);
      const info = output
        .split("\n")
        .find((line) => line.startsWith('{"descriptor"'));
      assert.ok(info !== undefined, output);
      const state = (
        JSON.parse(info) as {
          state: { youngTop: number; youngCapacity: number };
        }
      ).state;
      assert.ok(
        state.youngTop > 0 && state.youngTop <= state.youngCapacity,
        `young top ${state.youngTop} of ${state.youngCapacity}`,
      );
      assert.ok(
        output.split("\n").some((line) => line.startsWith('{"old"')),
        "the heap walks cleanly at the slow path",
      );
    } finally {
      rmSync(dirname(image), { recursive: true, force: true });
    }
  },
);
