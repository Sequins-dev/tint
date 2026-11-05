/** Build-only native batch for Promise.try and job-ordering evidence. Runs the
 * unchanged pinned `built-ins/Promise/try` sources in strict and sloppy variants
 * plus bespoke ordering cases. This tool never launches the image; the selected
 * case index is the image's first argument and every case must exit 42. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { testMetadata } from "./test262.ts";
import { executionPlan } from "./test262-execution.ts";
import {
  createNativeBatchBuilder,
  prepareNativeScripts,
} from "./test262-native.ts";
import {
  workspaceSources,
  workspaceSourceIdentity,
  saveWorkspaceSourceSnapshot,
} from "./workspace-sources.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("Promise.try fixture requires TINT_BUILD_ONLY=1");
const output = resolve(
  process.argv[2] ?? ".tint-bootstrap/promise-try-native-v1",
);
const checkout = resolve(process.argv[3] ?? ".tint-bootstrap/test262");
const directory = "test/built-ins/Promise/try";
const sha = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/** Orders agree with the specification's job sequence (and Node). */
const bespoke: readonly { name: string; source: string }[] = [
  {
    name: "callback-before-constructor",
    source:
      "var log=[];function C(executor){log.push('construct');executor(function(){log.push('resolve')},function(){log.push('reject')});}Promise.try.call(C,function(){log.push('callback');return 1;});Promise.try.call(C,function(){log.push('throwing');throw 2;});assert.sameValue(log.join(),'callback,construct,resolve,throwing,construct,reject');var calls=0;assert.throws(TypeError,function(){Promise.try.call(function(){},function(){calls++;});});assert.sameValue(calls,1);$DONE();",
  },
  {
    name: "non-callable-rejects",
    source:
      "Promise.try(42).then(function(){$DONE('unexpected');},function(e){assert.sameValue(e instanceof TypeError,true);$DONE();});",
  },
  {
    name: "thenable-adoption-order",
    source:
      "var log=[];var t={get then(){log.push('get');return function(r){log.push('call');r(5);};}};var p=Promise.try(function(){return t;});log.push('returned');p.then(function(v){log.push(v);assert.sameValue(log.join(),'get,returned,call,5');$DONE();},$DONE);",
  },
  {
    name: "job-ordering",
    source:
      "var log=[];var settled=Promise.resolve();new Promise(function(r){r(settled);}).then(function(){log.push('A');});Promise.resolve(1).finally(function(){}).then(function(v){log.push('f'+v);});Promise.resolve(3).finally(function(){throw 9;}).then(undefined,function(r){log.push('o'+r);});var p=Promise.resolve();[1,2,3,4,5].forEach(function(i){p=p.then(function(){log.push(i);});});p.then(function(){assert.sameValue(log.join(),'1,o9,2,A,3,f1,4,5');$DONE();},$DONE);",
  },
];

const cases: { scripts: never; asynchronous: boolean }[] = [];
const manifestCases: unknown[] = [];
function addCase(
  name: string,
  source: string,
  variant: "strict" | "sloppy",
  metadata: ReturnType<typeof testMetadata>,
  origin: unknown,
): void {
  const plan = executionPlan(source, variant, metadata);
  const harness = plan.harness.map((file) => {
    const filename = join(checkout, "harness", file);
    const text = readFileSync(filename, "utf8");
    return { filename, source: text, sha256: sha(text) };
  });
  const prepared = prepareNativeScripts(
    plan,
    variant,
    harness.map(({ filename, source }) => ({ filename, source })),
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
  manifestCases.push({
    index: cases.length,
    name,
    variant,
    origin,
    asynchronous: plan.asynchronous,
    harness: harness.map(({ filename, sha256 }) => ({
      name: filename.slice(checkout.length + 1),
      sha256,
    })),
    expectedExitStatus: 42,
  });
  cases.push({
    scripts: prepared.modules as never,
    asynchronous: plan.asynchronous,
  });
}

for (const file of readdirSync(join(checkout, directory)).sort()) {
  if (!file.endsWith(".js")) continue;
  const path = join(directory, file);
  const source = readFileSync(join(checkout, path), "utf8");
  const metadata = testMetadata(source);
  assert.equal(metadata.negative, undefined, path);
  for (const variant of ["strict", "sloppy"] as const) {
    if (
      metadata.flags.includes(variant === "strict" ? "noStrict" : "onlyStrict")
    )
      continue;
    addCase(file, source, variant, metadata, {
      test262: path.slice("test/".length),
      sha256: sha(source),
    });
  }
}
for (const { name, source } of bespoke)
  addCase(
    name,
    source,
    "strict",
    { flags: ["async"], features: ["promise-try"], includes: [] },
    { bespoke: true, sha256: sha(source) },
  );

const snapshot = workspaceSources();
const sourceSnapshot = workspaceSourceIdentity(snapshot);
const built = createNativeBatchBuilder(snapshot)(cases);
if (!built.ok) throw new Error(JSON.stringify(built.outcome));
mkdirSync(output);
saveWorkspaceSourceSnapshot(join(output, "workspace.sources.json"), snapshot);
const binary = join(output, "promise-try");
writeFileSync(binary, built.bytes, { mode: 0o755, flag: "wx" });
const manifest = join(output, "manifest.json");
writeFileSync(
  manifest,
  JSON.stringify(
    {
      sourceSnapshot,
      test262Revision: execFileSync(
        "git",
        ["-C", checkout, "rev-parse", "HEAD"],
        {
          encoding: "utf8",
        },
      ).trim(),
      binary: { path: binary, sha256: sha(built.bytes) },
      tool: {
        path: "tools/build-promise-try-native-fixture.ts",
        sha256: sha(
          readFileSync("tools/build-promise-try-native-fixture.ts", "utf8"),
        ),
      },
      invocation: "<binary> <case index>",
      cases: manifestCases,
      limits: [
        "Not executed by builder; each case must stop at entry under LLDB and exit 42.",
      ],
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(
  JSON.stringify({ sourceSnapshot, manifest, binary, cases: cases.length }),
);
