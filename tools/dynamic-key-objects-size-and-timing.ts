import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("dynamic-key object measurements require TINT_BUILD_ONLY=1");

const fixture = (await import(
  pathToFileURL(resolve("tools/hosted-fixture.ts")).href
)) as typeof import("./hosted-fixture.ts");

const minimal = "export function run(): number { return 42; }";
const dictionary = `
export function run(): number {
  const result: Record<string, number> = {};
  const key: string = "answer";
  result[key] = 42;
  return result[key] ?? 0;
}`;
const mixed = `
import { answer } from "./typed";
export function run() {
  var result = {};
  result.value = answer();
  return result.value;
}`;
const typed = "export function answer(): number { return 42; }";

const writes = `
export function run() {
  var object = { value: 0 };
  var i = 0;
  while (i < 500000) {
    object.value = i;
    i += 1;
  }
  return object.value === 499999 ? 42 : 1;
}`;

switch (process.argv[2]) {
  case "minimal":
    process.env.TINT_GENERAL_FALLBACK = "0";
    fixture.verifyHostedFixture(minimal, "dynamic-keys-minimal");
    break;
  case "dictionary":
    fixture.verifyHostedFixture(dictionary, "dynamic-keys-dictionary");
    break;
  case "mixed": {
    const parsed = parseModule(createSourceTextView(typed));
    assert.ok(parsed.ok, JSON.stringify(parsed));
    fixture.verifyHostedFixture(
      mixed,
      "dynamic-keys-mixed",
      [["./typed", "size:typed"]],
      [{ id: "size:typed", module: parsed.value, dependencies: new Map() }],
    );
    break;
  }
  case "writes":
    fixture.verifyHostedFixture(writes, "dynamic-keys-general-writes");
    break;
  default:
    throw Error("expected minimal, dictionary, mixed or writes");
}
