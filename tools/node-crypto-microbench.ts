// Build outside the timing lock. `build public` resolves the public module.
// `build branded` times the typed crypto code with its real Buffer adoption.
// `build branded-slots` reads the same Buffer's length through typed storage.
// Run paired rounds under tools/gate/with-lock.sh both:
//   NODE26=<node 26.13.1> node tools/node-crypto-microbench.ts run \
//     [--rounds N] <label>=<image>... [--control <label>=<image>]
// Each round runs every image under LLDB, Node 26.13.1 and a Node control in
// a rotated order. A Tint control image keeps the public call shapes with
// prebuilt results; the Node control does the same with a plain class.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash as referenceHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadavg } from "node:os";
import { verifyHostedFixture } from "./hosted-fixture.ts";

const clock = "packages/native-runtime/src/intrinsics/clock.ts";
interface BenchCase {
  readonly name: string;
  readonly setup: string;
  readonly expression: string;
  readonly iterations: number;
  readonly expected?: string;
}

function stringCase(size: number, ascii: boolean): BenchCase {
  const pattern = "aé雪😀"; // 10 UTF-8 bytes, with a surrogate pair.
  const input = ascii
    ? "a".repeat(size)
    : pattern.repeat(Math.floor(size / 10)) + "a".repeat(size % 10);
  return {
    name: `sha512-string-${ascii ? "ascii" : "unicode"}-${size}`,
    setup: `const input = ${JSON.stringify(input)};`,
    expression: 'createHash("sha512").update(input).digest("hex")',
    iterations: size === 64 ? 100000 : 20000,
    expected: referenceHash("sha512").update(input).digest("hex"),
  };
}

// Each short case spans several copying collections in the public image,
// so a whole collection pause does not land in whichever case triggers it.
const cases: readonly BenchCase[] = [
  {
    name: "sha256-64",
    setup: "const bytes = new Uint8Array(64);",
    expression: 'createHash("sha256").update(bytes).digest("hex")',
    iterations: 100000,
  },
  {
    name: "sha512-64",
    setup: "const bytes = new Uint8Array(64);",
    expression: 'createHash("sha512").update(bytes).digest("hex")',
    iterations: 100000,
  },
  stringCase(64, true),
  stringCase(64, false),
  stringCase(1024, true),
  stringCase(1024, false),
  {
    name: "hmac-sha256-64",
    setup: "const bytes = new Uint8Array(64); const key = new Uint8Array(32);",
    expression: 'createHmac("sha256", key).update(bytes).digest("hex")',
    iterations: 100000,
  },
  {
    name: "hmac-sha512-64",
    setup: "const bytes = new Uint8Array(64); const key = new Uint8Array(32);",
    expression: 'createHmac("sha512", key).update(bytes).digest("hex")',
    iterations: 100000,
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
    iterations: 250000,
  },
  {
    name: "random-4096",
    setup: "",
    expression: "randomBytes(4096)",
    iterations: 50000,
  },
];

const imports =
  'import { createHash, createHmac, randomBytes } from "node:crypto";';
const typedLength =
  process.argv[2] === "build" && process.argv[3] === "branded-slots";
const branded =
  typedLength || (process.argv[2] === "build" && process.argv[3] === "branded");
const body = cases
  .map(({ name, setup, expression, iterations, expected }) => {
    const randomBuffer = branded && name.startsWith("random-");
    const call = randomBuffer
      ? expression.replace("randomBytes", "randomBuffer")
      : expression;
    const length = randomBuffer
      ? "bufferLength(result)"
      : 'typeof result==="string"?result.length:result.length';
    return `{
  ${setup}
  ${expected === undefined ? "" : `if (${call} !== ${JSON.stringify(expected)}) throw "Wrong hash for ${name}";`}
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
  const length=${
    typedLength
      ? "buffer.internalRareSlots?.internalExoticSlots?.internalTypedArrayData?.length"
      : 'getProperty<ScriptPropertyKey,unknown>(buffer,"length",buffer,core.hooks)'
  };
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
      ? typedLength
        ? "node-crypto-slot-branded-microbench"
        : "node-crypto-branded-microbench"
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
  const oracle = process.env.NODE26;
  assert.ok(oracle, "run requires NODE26");
  assert.equal(command(oracle, ["--version"]).trim(), "v26.13.1");
  const args = process.argv.slice(3);
  let roundCount = 15;
  const images: { label: string; image: string; control: boolean }[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--rounds") roundCount = Number(args[++index]);
    else {
      const control = arg === "--control";
      const spec = control ? args[++index] : arg;
      const at = spec?.indexOf("=") ?? -1;
      assert.ok(spec && at > 0, "expected <label>=<image>: " + String(spec));
      images.push({
        label: spec.slice(0, at),
        image: spec.slice(at + 1),
        control,
      });
    }
  }
  assert.ok(Number.isInteger(roundCount) && roundCount > 0);
  assert.ok(
    images.some(({ control }) => !control),
    "no measured image",
  );
  const nodeSource = `${imports}
    const monotonicMilliseconds=()=>Number(process.hrtime.bigint())/1000000;
    ${body}`;
  // Same call shapes as the public module with prebuilt results.
  let controlBody = body;
  for (const item of cases)
    if (item.expected !== undefined)
      controlBody = controlBody.replace(
        JSON.stringify(item.expected),
        JSON.stringify("0".repeat(128)),
      );
  const nodeControlSource = `import { Buffer } from "node:buffer";
    const monotonicMilliseconds=()=>Number(process.hrtime.bigint())/1000000;
    class Hash {
      constructor(result) { this.result = result; }
      update(_input) { return this; }
      digest(_encoding) { return this.result; }
    }
    const sha256 = new Hash("0".repeat(64));
    const sha512 = new Hash("0".repeat(128));
    const random32 = Buffer.alloc(32);
    const random4096 = Buffer.alloc(4096);
    function createHash(algorithm) { return algorithm === "sha256" ? sha256 : sha512; }
    function createHmac(algorithm, _key) { return createHash(algorithm); }
    function randomBytes(size) { return size === 32 ? random32 : random4096; }
    ${controlBody}`;
  const native = (image: string) => {
    const output = command("lldb", [
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
    ]);
    assert.match(output, /^TINT_CRYPTO_EXIT_42$/m);
    return parse(output);
  };
  const variants: [string, () => ReturnType<typeof parse>][] = [
    ...images.map(
      ({ label, image }): [string, () => ReturnType<typeof parse>] => [
        label,
        () => native(image),
      ],
    ),
    [
      "node",
      () => parse(command(oracle, ["--input-type=module", "-e", nodeSource])),
    ],
    [
      "nodeControl",
      () =>
        parse(
          command(oracle, ["--input-type=module", "-e", nodeControlSource]),
        ),
    ],
  ];
  const labels = variants.map(([label]) => label);
  assert.equal(new Set(labels).size, labels.length, "duplicate labels");
  const rounds: {
    order: string[];
    load: number[];
    results: Record<string, ReturnType<typeof parse>>;
  }[] = [];
  for (let round = 0; round < roundCount; round++) {
    const shift = round % variants.length;
    const order = variants.slice(shift).concat(variants.slice(0, shift));
    const results: Record<string, ReturnType<typeof parse>> = {};
    const load = loadavg();
    for (const [label, measure] of order) results[label] = measure();
    // Controls return equal-length results, so every checksum must agree.
    for (const label of labels)
      for (const [index, result] of results[label]!.entries())
        assert.equal(result.checksum, results.node![index]!.checksum);
    rounds.push({ order: order.map(([label]) => label), load, results });
    console.error(`Round ${round + 1}/${roundCount} complete`);
  }
  const quartiles = (values: number[]) => {
    const sorted = values.slice().sort((a, b) => a - b);
    const at = (q: number) => {
      const position = (sorted.length - 1) * q;
      const low = Math.floor(position);
      const high = Math.ceil(position);
      return sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low);
    };
    return { q1: at(0.25), median: at(0.5), q3: at(0.75) };
  };
  const control = images.find((image) => image.control)?.label;
  const summary = cases.map(({ name }, index) => {
    const ns = (label: string, round: (typeof rounds)[number]) =>
      round.results[label]![index]!.ns;
    const entry: Record<string, unknown> = { name };
    for (const label of labels)
      entry[label + "Ns"] = quartiles(rounds.map((round) => ns(label, round)));
    for (const { label, control: isControl } of images) {
      if (isControl) continue;
      entry[label + "NodeOverTint"] = quartiles(
        rounds.map((round) => ns("node", round) / ns(label, round)),
      );
      if (control !== undefined)
        entry[label + "AdjustedNodeOverTint"] = quartiles(
          rounds.map(
            (round) =>
              (ns("node", round) - ns("nodeControl", round)) /
              (ns(label, round) - ns(control, round)),
          ),
        );
    }
    return entry;
  });
  const sha256 = (path: string) =>
    referenceHash("sha256").update(readFileSync(path)).digest("hex");
  console.log(
    JSON.stringify(
      {
        nodeVersion: "26.13.1",
        nodeOpenSSL: command(oracle, ["-p", "process.versions.openssl"]).trim(),
        images: images.map((image) => ({
          ...image,
          sha256: sha256(image.image),
        })),
        rounds,
        summary,
      },
      null,
      2,
    ),
  );
}
