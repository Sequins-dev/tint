// `pop` on typed number lists takes the number-list pop helper (inlined)
// instead of length, read and resize. Covered: dense lists, -0 and NaN
// elements, holey lists with holes and present undefined, popping a list
// empty (it is dense again afterwards), popping an empty list, and pushes
// and reads after pops. The same source runs in Node for the expected
// trace and natively under LLDB.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

// The fixture must compile on the typed path, not the general fallback (the
// builder reads this when it is imported).
process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");

const source = `let log = "";
function note(text: string): void {
  log += text + ";";
}
function show(value: number | undefined): string {
  if (value === undefined) return "u";
  return value === 0 && 1 / value < 0 ? "-0" : String(value);
}
function dense(): string {
  const values: number[] = [];
  for (let i = 0; i < 40; i++) values.push(i * 3 - 7);
  values.push(-0);
  values.push(NaN);
  let text = "";
  while (values.length > 30) text += show(values.pop()) + ",";
  text += "|" + String(values.length) + ":" + show(values[29]) + ":" + show(values[30]);
  return text;
}
function holey(): string {
  const values: (number | undefined)[] = [1, 2, 3];
  values[7] = 8;
  values[5] = undefined;
  let text = "";
  for (let i = 0; i < 10; i++)
    text += show(values.pop()) + "/" + String(values.length) + ",";
  return text;
}
function refill(): string {
  const values: number[] = [5, 6];
  values[4] = 9;
  let text = "";
  while (values.length > 0) text += show(values.pop()) + ",";
  text += show(values.pop()) + "|";
  for (let i = 0; i < 6; i++) values.push(i * i);
  for (let i = 0; i < values.length; i++) text += show(values[i]) + ",";
  text += show(values.pop()) + ":" + String(values.length);
  return text;
}
function sums(rounds: number): number {
  let total = 0;
  for (let round = 0; round < rounds; round++) {
    const stack: number[] = [];
    for (let i = 0; i < 64; i++) stack.push((i * round) & 255);
    while (stack.length > 16) total = (total + (stack.pop() ?? 0)) | 0;
    total = (total * 31 + stack.length) | 0;
  }
  return total;
}
export function trace(): string {
  note(dense());
  note(holey());
  note(refill());
  note(String(sums(200)));
  return log;
}
`;

async function expectedTrace(text: string): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), "tint-number-list-pop-"));
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

test("number lists pop as in ECMAScript", async () => {
  const expected = await expectedTrace(source);
  verifyHostedFixture(
    source +
      `export function run(): number { return trace() === ${JSON.stringify(expected)} ? 42 : 1; }\n`,
    "number-list-pop",
    [],
    [],
    [],
    [],
    { requireTyped: true, managedBytes: 67108864, allocationCapacity: 1048576 },
  );
});
