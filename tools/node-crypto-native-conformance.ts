import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { nativeFixtureTarget } from "./native-host-target.ts";
import { nativeArtifact, runNativeBatch } from "./native-target-runner.ts";
import { prepareHostedFixture } from "./hosted-fixture.ts";
import { extractCryptoCases } from "./node-crypto-conformance.ts";

type Cases = ReturnType<typeof extractCryptoCases>;

function caseName({
  file,
  ranges,
  name,
}: Pick<Cases[number], "file" | "ranges" | "name">): string {
  return (
    file + ":" + ranges.map((range) => range.join("-")).join(",") + " " + name
  );
}

// Harness-provided assertions and Node's common callback accounting. The case
// bodies are copied directly from the pinned source with their original bytes.
const harness = `
import crypto from "node:crypto";
import { Buffer } from "node:buffer";
function equal(actual, expected, message) {
  if (!Object.is(actual, expected))
    throw new Error((message ?? 'strictEqual') + ': ' + String(actual) + ' != ' + String(expected));
}
function equivalent(actual, expected) {
  if (Object.is(actual, expected)) return true;
  if (typeof actual !== 'object' || actual === null ||
      typeof expected !== 'object' || expected === null) return false;
  if (Object.getPrototypeOf(actual) !== Object.getPrototypeOf(expected)) return false;
  const a = Object.keys(actual);
  const b = Object.keys(expected);
  if (a.length !== b.length) return false;
  for (const key of a) if (!b.includes(key) || !equivalent(actual[key], expected[key])) return false;
  return true;
}
const counted = [];
let currentCase = '';
function mustCall(callback, expected = 1) {
  const record = { name: currentCase, calls: 0, expected };
  counted.push(record);
  return function(...args) {
    record.calls++;
    if (record.calls > expected) throw new Error(record.name + ': callback ran too often');
    if (callback !== undefined) return Reflect.apply(callback, this, args);
  };
}
function invalidArgTypeHelper(input) {
  if (input === null || input === undefined) return ' Received ' + String(input);
  if (typeof input === 'object') return ' Received an instance of ' + Object.getPrototypeOf(input).constructor.name;
  const text = typeof input === 'string' ? "'" + input + "'" : String(input);
  return ' Received type ' + typeof input + ' (' + text + ')';
}
const common = {
  mustCall,
  mustNotCall() { return () => {throw new Error('Unexpected callback');}; },
  mustSucceed(callback) {
    return mustCall((error, ...args) => {
      equal(error, null, 'Unexpected callback failure');
      if (callback !== undefined) callback(...args);
    });
  },
  invalidArgTypeHelper,
};
const hasFIPS = () => false;
const assert = {
  strictEqual: equal,
  notStrictEqual(actual, expected, message) {
    if (Object.is(actual, expected)) throw new Error(message ?? 'notStrictEqual');
  },
  deepStrictEqual(actual, expected, message) {
    if (!equivalent(actual, expected)) throw new Error(message ?? 'deepStrictEqual');
  },
  throws(body, expected) {
    try { body(); }
    catch (error) {
      if (expected instanceof RegExp) {
        if (!expected.test(String(error))) throw error;
      } else if (typeof expected === 'function') {
        if (expected === Error || Error.prototype.isPrototypeOf(expected.prototype)) {
          if (!(error instanceof expected)) throw error;
        } else equal(expected(error), true);
      } else if (expected !== undefined) {
        for (const key of Object.keys(expected)) {
          if (expected[key] instanceof RegExp) {
            if (!expected[key].test(error[key])) throw error;
          } else equal(error[key], expected[key], key);
        }
      }
      return;
    }
    throw new Error('Missing expected exception');
  }
};
`;
function fixtureSource(selected: Cases): string {
  const declarations = selected
    .map(({ source }, index) => `function check${index}() {\n${source}\n}\n`)
    .join("");
  const entries = selected
    .map(({ file, name, ranges }, index) => {
      const id = JSON.stringify(caseName({ file, ranges, name }));
      return `currentCase=${id};
  try { check${index}(); checked.push(currentCase); } catch(error) { failed++; console.error('FAIL ' + currentCase + ' ' + String(error)); }`;
    })
    .join("\n");
  return `"use strict";\n${harness}\n${declarations}
export async function run() { let failed=0; const checked=[];
${entries}
for(let tries=0; tries<200 && counted.some(entry => entry.calls<entry.expected); tries++)
  await new Promise(resolve => setTimeout(resolve,5));
for (const name of checked) {
  if (counted.some(entry => entry.name === name && entry.calls !== entry.expected)) {
    failed++;
    console.error('FAIL ' + name + ' callback count');
  } else console.log('PASS ' + name);
}
return failed === 0 ? 42 : failed; }
`;
}

const [root, output] = process.argv.slice(2);
assert.ok(
  root && output,
  "Usage: node tools/node-crypto-native-conformance.ts <node-source> <report-path>",
);
const target = nativeFixtureTarget().name;
const selected = extractCryptoCases(root);
const files = [...new Set(selected.map(({ file }) => file))];
const cases = new Map(
  files.map((file) => [file, selected.filter((item) => item.file === file)]),
);
const buildErrors: { file: string; error: string }[] = [];
const jobs = [];
for (const [file, groups] of cases) {
  try {
    const image = prepareHostedFixture(
      fixtureSource(groups),
      file.slice(0, -3),
      [["node:buffer", "packages/native-runtime/src/node/buffer.ts"]],
      [],
      [],
      [],
      {
        nodeCrypto: "esm",
        managedBytes: 67108864,
        allocationCapacity: 1048576,
      },
    );
    jobs.push({
      file,
      artifact: nativeArtifact(target, image, image + ".manifest.json"),
      timeoutMs: 30000,
    });
  } catch (error) {
    buildErrors.push({ file, error: String(error) });
  }
}
const observations = runNativeBatch(jobs, {
  ...process.env,
  TINT_LINUX_DEBUGGER_LAUNCH: "lldb",
  ...(process.platform === "linux" &&
  process.arch === "x64" &&
  process.env.TINT_NATIVE_RUNNER === undefined
    ? { TINT_NATIVE_RUNNER: "x64-local" }
    : {}),
});
const results = jobs.map(({ file }, index) => {
  const observation = observations[index];
  assert.ok(observation, file);
  const groups = cases.get(file);
  assert.ok(groups, file);
  const expected = groups.map(caseName);
  const seen = observation.stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith("PASS "))
    .map((line) => line.slice(5));
  const missing = expected.filter((name) => !seen.includes(name));
  const unexpected = seen.filter((name) => !expected.includes(name));
  const valid =
    observation.kind === "exited" &&
    observation.status === 42 &&
    seen.length === expected.length &&
    missing.length === 0 &&
    unexpected.length === 0;
  return {
    file,
    selected: expected.length,
    passed: expected.length - missing.length,
    missing,
    unexpected,
    valid,
    observation,
  };
});
const passed = results.reduce((total, result) => total + result.passed, 0);
const valid =
  buildErrors.length === 0 && results.every((result) => result.valid);
writeFileSync(
  output,
  JSON.stringify(
    { target, selected: selected.length, passed, valid, buildErrors, results },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.error(
  target + " passed " + passed + "/" + selected.length + " crypto case groups",
);
process.exitCode = Number(!valid);
