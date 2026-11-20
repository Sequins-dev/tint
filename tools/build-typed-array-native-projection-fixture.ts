import { verifyHostedFixture } from "./hosted-fixture.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("native typed-array fixture requires TINT_BUILD_ONLY=1");
process.env.TINT_GENERAL_FALLBACK = "0";

verifyHostedFixture(
  `
function byte(array: Uint8Array): void { array[0] = 42; }
function half(array: Uint16Array): void { array[0] = 512; }
function word(array: Uint32Array): void { array[0] = 65536; }
function double(array: Float64Array): void { array[0] = 1.5; }
function call(value: unknown): number {
  if (value instanceof Uint8Array) { byte(value); return value[0] ?? 0; }
  if (value instanceof Uint16Array) { half(value); return (value[0] ?? 0) / 512; }
  if (value instanceof Uint32Array) { word(value); return (value[0] ?? 0) / 65536; }
  if (value instanceof Float64Array) { double(value); return (value[0] ?? 0) * 2; }
  return 0;
}
function copy(target: unknown, source: unknown): number {
  if (target instanceof Uint8Array && source instanceof Uint8Array) {
    target.set(source);
    return target[0] ?? 0;
  }
  return 0;
}
export function run(): number {
  const value = new Uint8Array(1);
  if (call(value) !== 42 || value[0] !== 42) return 1;
  if (call(new Uint16Array(1)) !== 1) return 2;
  if (call(new Uint32Array(1)) !== 1) return 3;
  if (call(new Float64Array(1)) !== 3) return 4;
  if (call("not an array") !== 0) return 5;
  if (copy(new Uint8Array(1), value) !== 42) return 6;
  return 42;
}
`,
  "typed-array-native-projection",
);
