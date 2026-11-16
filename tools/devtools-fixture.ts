// A native Tint fixture for the DevTools bridge tests (docs/native-devtools.md):
// an inlined callee for frame presentation, strings, lists, records, a Map,
// a Set and general values for value formatting, a retained chain for heap
// snapshots, and a long allocation-heavy tail for pausing, CPU profiles,
// allocation sampling and forced collections while it runs.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { startDevTools, type DevToolsSession } from "./devtools/cli.ts";
import type { BridgePlugin } from "./devtools/plugin.ts";
import { CdpTestClient } from "./devtools/test-client.ts";
import { verifyHostedFixture } from "./hosted-fixture.ts";

/** Lines referenced by the tests (1-based, in the `fixture` source). */
export const fixtureLines = {
  weight: 17,
  scale: 21,
  inspect: 27,
  churnLoop: 33,
} as const;
/** Rounds of 2000-node chains in the tail. */
export const churnRounds = 1500000;
export const devtoolsFixtureSource = `interface Point { x: number; y: number; label: string }
interface Holder {
  readonly items: Point[];
  readonly names: string[];
  readonly numbers: number[];
  readonly index: Map<string, Point>;
  readonly tags: Set<string>;
  readonly anything: unknown;
  readonly note: unknown;
}
interface Node { readonly value: number; readonly next: Node | undefined }
function makeChain(length: number): Node | undefined {
  let node: Node | undefined = undefined;
  for (let i = 0; i < length; i++) node = { value: i, next: node };
  return node;
}
function weight(value: number): number {
  const doubled = value * 2;
  return doubled + 1;
}
function scale(point: Point, factor: number): number {
  const w = weight(point.x);
  return w * factor + point.y;
}
function inspect(holder: Holder, retained: Node | undefined): number {
  const count = holder.items.length + holder.names.length + holder.numbers.length + holder.index.size + holder.tags.size;
  holder.items.push({ x: count, y: 0, label: "marker" });
  return count + (retained === undefined ? 100 : 0) + holder.items.length - 4;
}
function churn(rounds: number): number {
  let total = 0;
  for (let round = 0; round < rounds; round++) {
    const list = makeChain(2000);
    total += list === undefined ? 0 : list.value;
  }
  return total;
}
export function run(): number {
  const items: Point[] = [];
  for (let i = 0; i < 3; i++) items.push({ x: i, y: i * 2, label: "p" + String(i) });
  const names: string[] = ["alpha", "beta"];
  const numbers: number[] = [1.5, 2.5, 3.5];
  const index = new Map<string, Point>();
  index.set("first", items[0] ?? { x: 0, y: 0, label: "" });
  index.set("second", items[1] ?? { x: 0, y: 0, label: "" });
  const tags = new Set<string>();
  tags.add("red");
  tags.add("green");
  const anything: unknown = items[2];
  const note: unknown = "dynamic";
  const holder: Holder = { items, names, numbers, index, tags, anything, note };
  const retained = makeChain(5000);
  let scaled = 0;
  for (let i = 0; i < 3; i++) scaled += scale(items[i] ?? { x: 0, y: 0, label: "" }, 2);
  const count = inspect(holder, retained);
  const churned = churn(${String(churnRounds)});
  return count === 12 && scaled === 24 && churned === ${String(churnRounds)} * 1999 ? 42 : 1;
}
`;

/** Builds the fixture as a debug image (heap introspection on). */
export function buildDevToolsFixture(name: string): string {
  const saved = {
    debug: process.env.TINT_DEBUG_SYMBOLS,
    only: process.env.TINT_BUILD_ONLY,
  };
  process.env.TINT_DEBUG_SYMBOLS = "1";
  process.env.TINT_BUILD_ONLY = "1";
  try {
    return verifyHostedFixture(devtoolsFixtureSource, name, [], [], [], [], {
      managedBytes: 67108864,
      allocationCapacity: 4194304,
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

export interface Frame {
  callFrameId: string;
  functionName: string;
  location: { scriptId: string; lineNumber: number; columnNumber: number };
  url: string;
  scopeChain: { type: string; name?: string; object: { objectId: string } }[];
}
export interface Property {
  name: string;
  value: {
    type: string;
    subtype?: string;
    value?: unknown;
    objectId?: string;
    className?: string;
    description?: string;
  };
}

/** A fixture session: the image, its source on disk and a connected,
 * enabled client (the program waits for runIfWaitingForDebugger). */
export async function tintSession(
  name: string,
  plugins: readonly BridgePlugin[],
): Promise<{
  session: DevToolsSession;
  client: CdpTestClient;
  url: string;
  close: () => Promise<void>;
}> {
  const image = buildDevToolsFixture(name);
  const dir = mkdtempSync(join(tmpdir(), "tint-devtools-tint-"));
  const sourceFile = join(dir, "fixture.ts");
  writeFileSync(sourceFile, devtoolsFixtureSource);
  const session = await startDevTools({
    program: image,
    port: 0,
    wait: true,
    plugins,
    sourceMap: new Map([["fixture", sourceFile]]),
    trace: process.env.TINT_DEVTOOLS_TRACE === "1",
    log:
      process.env.TINT_DEVTOOLS_TRACE === "1"
        ? (text) =>
            process.stderr.write(
              String(Date.now() % 1000000) + " " + text + "\n",
            )
        : () => {},
  });
  const client = await CdpTestClient.connect(session.server.webSocketUrl);
  await client.send("Runtime.enable");
  await client.send("Debugger.enable");
  return {
    session,
    client,
    url: pathToFileURL(sourceFile).href,
    close: async () => {
      client.close();
      await session.close();
      rmSync(dir, { recursive: true, force: true });
      rmSync(dirname(image), { recursive: true, force: true });
    },
  };
}

export async function properties(
  client: CdpTestClient,
  objectId: string | undefined,
): Promise<Property[]> {
  assert.ok(objectId !== undefined, "an expandable object");
  return (
    await client.send<{ result: Property[] }>("Runtime.getProperties", {
      objectId,
      ownProperties: true,
      generatePreview: true,
    })
  ).result;
}

export function localScope(frame: Frame | undefined): string {
  const scope = frame?.scopeChain.find((entry) => entry.type === "local");
  assert.ok(scope !== undefined, "a local scope");
  return scope.object.objectId;
}
