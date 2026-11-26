// A typed read or write of a `let` binding, or a `new` of a class, before
// its declaration has run is the binding's temporal dead zone: a catchable
// ReferenceError with V8's message naming the source binding, also inside
// a `try` in a function hoisted above the declaration. The same source runs
// in Node for the expected trace and natively under LLDB on the typed path.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

// The fixtures must compile on the typed path, not the general fallback (the
// builder reads this when it is imported).
process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");

const messages = `function describe(e: unknown): string {
  return e instanceof Error ? e.message : "other";
}
function readEarly(): string {
  try {
    return String(value);
  } catch (e) {
    return describe(e);
  }
}
function writeEarly(): string {
  try {
    value = 2;
    return "wrote";
  } catch (e) {
    return describe(e);
  }
}
function constructEarly(): string {
  try {
    return new Late().name;
  } catch (e) {
    return describe(e);
  }
}
const before = readEarly() + ";" + writeEarly() + ";" + constructEarly();
let value: number = 1;
class Late {
  name: string = "late";
}
const after = readEarly() + ";" + writeEarly() + ";" + constructEarly();
export function trace(): string {
  return before + "|" + after + "|" + String(value);
}
`;

// `instanceof ReferenceError` brings in the program realm.
const realmClassification = `function describe(e: unknown): string {
  return (e instanceof ReferenceError ? "R:" : "") + (e instanceof Error ? e.message : "other");
}
function readEarly(): string {
  try {
    return String(value);
  } catch (e) {
    return describe(e);
  }
}
function writeEarly(): string {
  try {
    value = 2;
    return "wrote";
  } catch (e) {
    return describe(e);
  }
}
function constructEarly(): string {
  try {
    return new Late().name;
  } catch (e) {
    return describe(e);
  }
}
const before = readEarly() + ";" + writeEarly() + ";" + constructEarly();
let value: number = 1;
class Late {
  name: string = "late";
}
const after = readEarly() + ";" + writeEarly() + ";" + constructEarly();
export function trace(): string {
  return before + "|" + after + "|" + String(value);
}
`;

async function expectedTrace(text: string): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), "tint-tdz-"));
  try {
    const file = join(directory, "fixture.ts");
    writeFileSync(file, text);
    const module = (await import(pathToFileURL(file).href)) as {
      trace(): string;
    };
    return module.trace();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

for (const [name, source, prefix] of [
  [
    "temporal dead zone reads and writes throw ReferenceError",
    messages,
    "Cannot access 'value'",
  ],
  [
    "temporal dead zone errors are ReferenceError instances",
    realmClassification,
    "R:Cannot access 'value'",
  ],
] as const)
  test(name, async () => {
    const expected = await expectedTrace(source);
    assert.ok(expected.startsWith(prefix), expected);
    verifyHostedFixture(
      source +
        `export function run(): number { return trace() === ${JSON.stringify(expected)} ? 42 : 1; }\n`,
      "temporal-dead-zone",
      [],
      [],
      [],
      [],
      {
        requireTyped: true,
        managedBytes: 67108864,
        allocationCapacity: 1048576,
      },
    );
  });
