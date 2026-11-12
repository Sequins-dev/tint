// Equality with a string literal of up to eight UTF-16 units compiles inline
// (packages/codegen/src/aarch64/scalar/index.ts): length and units compare
// without the string-equal helper, branch-free up to four units. Checked
// natively against the host engine for literals of every length 0..9,
// candidates that differ only in their last unit, in length, or not at all,
// non-ASCII units, strings built at run time, both operand orders, and !==.
import { verifyHostedFixture } from "./hosted-fixture.ts";

export const source = `function build(parts: string[]): string {
  let text = "";
  for (let i = 0; i < parts.length; i++) text += parts[i] ?? "";
  return text;
}
function classify(s: string): number {
  let code = 0;
  if (s === "") code += 1;
  if (s === "a") code += 2;
  if ("ab" === s) code += 4;
  if (s === "abc") code += 8;
  if (s === "load") code += 16;
  if (s !== "store") code += 32;
  if (s === "abcdef") code += 64;
  if (s === "abcdefgh") code += 128;
  if (s === "abcdefghi") code += 256;
  if (s === "\\u00e9t\\u00e9") code += 512;
  if (s === "\\ud83d\\ude00x") code += 1024;
  return code;
}
export function run(): number {
  const inputs: string[] = [
    "", "a", "b", "ab", "aB", "abc", "abd", "load", "loaf", "lo", "loads",
    "store", "stork", "abcdef", "abcdeg", "abcde", "abcdefgh", "abcdefgg",
    "abcdefghi", "abcdefghj", "\\u00e9t\\u00e9", "\\u00e9t\\u00e8",
    "\\ud83d\\ude00x", "\\ud83d\\ude00y",
  ];
  let total = 0;
  for (let i = 0; i < inputs.length; i++) {
    const s = inputs[i] ?? "";
    total = total * 3 + classify(s);
    // The same content built at run time (a distinct allocation).
    const parts: string[] = [];
    for (let k = 0; k < s.length; k++) parts.push(s.charAt(k));
    total = (total * 7 + classify(build(parts))) % 1000000007;
  }
  return total;
}`;

verifyHostedFixture(
  source.replace(
    "export function run(): number {",
    "function compute(): number {",
  ) +
    `
export function run(): number { return compute() === ${(() => {
      const fn = new Function(
        source
          .replace(/: (number|string)\[\]/g, "")
          .replace(/: (number|string)/g, "")
          .replace(/export /, "") + "\nreturn run();",
      );
      return fn() as number;
    })()} ? 42 : 1; }`,
  "string-literal-equality",
  [],
  [],
  [],
  [],
  {
    runtimeEntry: "initializeCopyingRuntime",
    managedBytes: 4194304,
    allocationCapacity: 65536,
    rootCapacity: 4096,
    stackBytes: 1048576,
  },
);
