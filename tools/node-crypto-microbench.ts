// Build outside the timing lock. `build public` resolves the public module.
// `build branded` times the typed crypto code with its real Buffer adoption.
// Run paired rounds under the timing and gate locks, in that order.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { verifyHostedFixture } from "./hosted-fixture.ts";

const clock = "packages/native-runtime/src/intrinsics/clock.ts";
const cases = [
  {
    name: "sha256-64",
    setup: "const bytes = new Uint8Array(64);",
    expression: 'createHash("sha256").update(bytes).digest("hex")',
    iterations: 20000,
  },
  {
    name: "sha512-64",
    setup: "const bytes = new Uint8Array(64);",
    expression: 'createHash("sha512").update(bytes).digest("hex")',
    iterations: 20000,
  },
  {
    name: "hmac-sha256-64",
    setup: "const bytes = new Uint8Array(64); const key = new Uint8Array(32);",
    expression: 'createHmac("sha256", key).update(bytes).digest("hex")',
    iterations: 20000,
  },
  {
    name: "hmac-sha512-64",
    setup: "const bytes = new Uint8Array(64); const key = new Uint8Array(32);",
    expression: 'createHmac("sha512", key).update(bytes).digest("hex")',
    iterations: 20000,
  },
  {
    name: "sha256-1MiB",
    setup: "const bytes = new Uint8Array(1048576);",
    expression: 'createHash("sha256").update(bytes).digest("hex")',
    iterations: 256,
  },
  {
    name: "sha512-1MiB",
    setup: "const bytes = new Uint8Array(1048576);",
    expression: 'createHash("sha512").update(bytes).digest("hex")',
    iterations: 256,
  },
  {
    name: "random-32",
    setup: "",
    expression: "randomBytes(32)",
    iterations: 50000,
  },
  {
    name: "random-4096",
    setup: "",
    expression: "randomBytes(4096)",
    iterations: 10000,
  },
];

const imports =
  'import { createHash, createHmac, randomBytes } from "node:crypto";';
const branded = process.argv[2] === "build" && process.argv[3] === "branded";
const body = cases
  .map(({ name, setup, expression, iterations }) => {
    const randomBuffer = branded && name.startsWith("random-");
    const call = randomBuffer
      ? expression.replace("randomBytes", "randomBuffer")
      : expression;
    const length = randomBuffer
      ? "bufferLength(result)"
      : 'typeof result==="string"?result.length:result.length';
    return `{
  ${setup}
  let checksum=0;
  for(let i=0;i<${Math.max(64, Math.floor(iterations / 4))};i++){
    const result=${call};
    checksum+=${length};
  }
  const start=monotonicMilliseconds();
  for(let i=0;i<${iterations};i++){
    const result=${call};
    checksum+=${length};
  }
  const elapsed=monotonicMilliseconds()-start;
  console.log("TINT_CRYPTO_BENCH ${name} "+String(elapsed*1000000/${iterations})+" "+String(checksum));
}`;
  })
  .join("\n");

function command(file: string, args: readonly string[], exit = 0): string {
  const result = spawnSync(file, args, { encoding: "utf8", timeout: 90000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, exit, result.stdout + result.stderr);
  return result.stdout;
}

function parse(text: string): { name: string; ns: number; checksum: number }[] {
  const result = Array.from(
    text.matchAll(/(?:^|\n)TINT_CRYPTO_BENCH (\S+) (\S+) (\S+)/g),
    ([, name, ns, checksum]) => ({
      name: name ?? "",
      ns: Number(ns),
      checksum: Number(checksum),
    }),
  );
  assert.deepEqual(
    result.map(({ name }) => name),
    cases.map(({ name }) => name),
  );
  assert.ok(result.every(({ ns }) => Number.isFinite(ns) && ns > 0));
  return result;
}

if (process.argv[2] === "build") {
  const publicDriver = process.argv[3] === "public";
  const dependencies: [string, string][] = [["clock", clock]];
  if (!publicDriver)
    dependencies.push([
      "node:crypto",
      "packages/native-runtime/src/node/crypto.ts",
    ]);
  if (branded)
    dependencies.push(
      ["node-buffer", "packages/native-runtime/src/node/buffer.ts"],
      ["objects", "packages/js-runtime/src/objects/index.ts"],
    );
  const bufferPrelude = branded
    ? `
import { adoptNodeBuffer, isNodeBuffer } from "node-buffer";
import { programRealmCore, getProperty, type ScriptPropertyKey, type OrdinaryObject, type ProgramRealmCore } from "objects";
const core:ProgramRealmCore=programRealmCore();
function randomBuffer(size:number):OrdinaryObject<ScriptPropertyKey,unknown> {
  return adoptNodeBuffer(core,randomBytes(size));
}
function bufferLength(buffer:OrdinaryObject<ScriptPropertyKey,unknown>):number {
  const length=getProperty<ScriptPropertyKey,unknown>(buffer,"length",buffer,core.hooks);
  if(typeof length!=="number")throw "BUFFER_LENGTH";
  return length;
}
`
    : "";
  const objects = "packages/js-runtime/src/objects/index.ts";
  const views = ["viewObjectValue", "viewSymbolValue", "viewBigIntValue"];
  process.env.TINT_BUILD_ONLY = "1";
  if (!publicDriver) process.env.TINT_GENERAL_FALLBACK = "0";
  verifyHostedFixture(
    `${imports}\nimport {monotonicMilliseconds} from "clock";
     ${bufferPrelude}
     export function run():number { ${branded ? "if(!isNodeBuffer(core,randomBuffer(0))) return 1;" : ""} ${body} return 42; }`,
    branded
      ? "node-crypto-branded-microbench"
      : publicDriver
        ? "node-crypto-public-microbench"
        : "node-crypto-microbench",
    dependencies,
    [],
    branded
      ? views.map((name) => ({
          module: objects,
          name,
          operation: "view" as const,
        }))
      : [],
    publicDriver
      ? []
      : [
          {
            module: clock,
            namespace: "crypto-bench-clock",
            retainedExports: ["monotonicMilliseconds"],
          },
          ...(branded
            ? [
                {
                  module: objects,
                  namespace: "crypto-bench-objects",
                  retainedExports: views,
                },
              ]
            : []),
        ],
    {
      ...(publicDriver
        ? { nodeCrypto: "esm" as const }
        : { requireTyped: true }),
      managedBytes: publicDriver ? 268435456 : 67108864,
      allocationCapacity: publicDriver ? 4194304 : 1048576,
      hostBindings: publicDriver
        ? []
        : [
            {
              module: clock,
              name: "monotonicMilliseconds",
              operation: "monotonic-time",
            },
          ],
    },
  );
} else {
  assert.equal(process.argv[2], "run");
  const image = process.argv[3];
  const oracle = process.env.NODE26;
  assert.ok(image && oracle, "run requires a native image and NODE26");
  assert.equal(command(oracle, ["--version"]).trim(), "v26.13.1");
  const nodeSource = `${imports}
    const monotonicMilliseconds=()=>Number(process.hrtime.bigint())/1000000;
    ${body}`;
  const native = () =>
    parse(
      command("lldb", [
        "--no-lldbinit",
        "--batch",
        "-o",
        "settings set target.disable-aslr false",
        "-o",
        "settings set target.process.stop-on-sharedlibrary-events false",
        "-o",
        "process launch --stop-at-entry",
        "-o",
        "script assert lldb.process.GetState() == lldb.eStateStopped",
        "-o",
        "continue",
        "-o",
        "script assert lldb.process.GetState() == lldb.eStateExited and lldb.process.GetExitStatus() == 42; print('TINT_CRYPTO_EXIT_42')",
        image,
      ]),
    );
  const node = () =>
    parse(command(oracle, ["--input-type=module", "-e", nodeSource]));
  const rounds: {
    tint: ReturnType<typeof parse>;
    node: ReturnType<typeof parse>;
  }[] = [];
  for (let round = 0; round < 5; round++) {
    const measured =
      round % 2 === 0
        ? { tint: native(), node: node() }
        : { node: node(), tint: native() };
    for (const [index, result] of measured.tint.entries())
      assert.equal(result.checksum, measured.node[index]?.checksum);
    rounds.push(measured);
    console.error(`Round ${round + 1}/5 complete`);
  }
  const summary = cases.map(({ name }, index) => {
    const paired = rounds
      .map((round) => round.node[index]!.ns / round.tint[index]!.ns)
      .sort((a, b) => a - b);
    return { name, medianNodeOverTint: paired[2] };
  });
  console.log(
    JSON.stringify(
      {
        nodeVersion: "26.13.1",
        nodeOpenSSL: command(oracle, ["-p", "process.versions.openssl"]).trim(),
        rounds,
        summary,
      },
      null,
      2,
    ),
  );
}
