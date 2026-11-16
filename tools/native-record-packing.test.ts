// Record layouts (placeRecordFields) pack one-byte presence and cell state
// tags after the payload words instead of a word per tag, and union field
// reads fuse into one membership test per field offset (record-dispatch.ts):
// the members here place \`kind\` and \`start\` at different offsets. The
// fixture reads union fields through every typed access form (direct, union
// dispatch and switch, a wider alias type, spread, narrowing, optional
// chaining), constructs unions from tagged spreads, and sets and overwrites
// optional numbers, booleans, strings and references (more tags than fit in
// one word) with collections moving the objects in between. The same source
// runs in Node for the expected checksum and natively under LLDB.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

// The fixture must compile on the typed path, not the general fallback (the
// builder reads this when it is imported).
process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");

const source = `interface Add {
  readonly start: number;
  readonly kind: "add";
  readonly left: number;
  readonly right: number;
}
interface Neg {
  readonly start: number;
  readonly kind: "neg";
  readonly value: number;
}
interface Lit {
  readonly kind: "lit";
  readonly start: number;
  readonly value: number;
  readonly note?: string;
  readonly flag?: boolean;
}
interface Call {
  readonly start: number;
  readonly kind: "call";
  readonly op: "direct";
  readonly target: string;
  readonly args: readonly Node[];
}
type Node = Add | Neg | Lit | Call;
// Two types with one structure share a layout holding both discriminants.
interface Left {
  readonly side: "left";
  readonly weight: number;
}
interface Right {
  readonly side: "right";
  readonly weight: number;
}
type Side = Left | Right;
interface Tagged {
  readonly tag: "tag";
  readonly n: number;
}
interface Options {
  count?: number;
  enabled?: boolean;
  label?: string;
  child?: Options;
  a?: boolean;
  b?: boolean;
  c?: boolean;
  d?: boolean;
  e?: boolean;
  f?: boolean;
  g?: boolean;
  h?: boolean;
  i?: number;
  readonly id: number;
}
function mix(total: number, value: number): number {
  return (total * 31 + value) % 1000003;
}
function hash(text: string): number {
  let total = text.length;
  for (let i = 0; i < text.length; i++)
    total = mix(total, text.charCodeAt(i));
  return total;
}
function make(i: number): Node {
  switch (i % 4) {
    case 0:
      return { start: i, kind: "add", left: i * 2, right: i + 3 };
    case 1:
      return { start: i, kind: "neg", value: -i };
    case 2:
      return i % 3 === 0
        ? { kind: "lit", start: i, value: i * 5, note: "n" + String(i) }
        : { kind: "lit", start: i, value: i * 5, flag: i % 5 === 0 };
    default:
      return {
        start: i,
        kind: "call",
        op: "direct",
        target: "f" + String(i % 7),
        args: [{ start: i, kind: "neg", value: i }],
      };
  }
}
function evaluate(node: Node): number {
  switch (node.kind) {
    case "add":
      return node.left + node.right;
    case "neg":
      return -node.value;
    case "lit":
    {
      const note = node.note;
      return node.value + (note === undefined ? 0 : hash(note));
    }
    case "call": {
      let total = hash(node.target) + hash(node.op);
      for (const arg of node.args) if (arg !== undefined) total += evaluate(arg);
      return total;
    }
  }
}
function kindOf(node: Node): string {
  return node.kind;
}
function aliased(node: Node): number {
  const alias: { readonly kind: string; readonly start: number } = node;
  return hash(alias.kind) + alias.start;
}
function spread(node: Node): number {
  const copy = { ...node };
  return hash(copy.kind) + copy.start;
}
function narrowed(node: Node): number {
  if (node.kind !== "add" && node.kind !== "neg") return hash(node.kind) + 1;
  return node.kind === "add" ? node.left : node.value;
}
function maybeKind(node: Node | undefined): string {
  return node?.kind ?? "none";
}
function sides(): number {
  const items: Side[] = [];
  for (let i = 0; i < 20; i++)
    items.push(i % 3 === 0 ? { side: "left", weight: i } : { side: "right", weight: -i });
  let total = 0;
  for (const item of items)
    if (item !== undefined) total = mix(total, hash(item.side) + item.weight);
  return total;
}
// Literal-typed fields constructed from values rather than literals.
function tagOf(value: "tag"): "tag" {
  return value;
}
function tags(count: number, pick: "tag"): number {
  let total = 0;
  const tagged: Tagged[] = [];
  for (let i = 0; i < count; i++) {
    tagged.push({ tag: pick, n: i });
    tagged.push({ tag: tagOf(pick), n: -i });
  }
  for (const item of tagged)
    if (item !== undefined) total = mix(total, hash(item.tag) + item.n);
  return total;
}
// Later rounds set absent fields and overwrite present ones (the typed
// path has no \`delete\` or \`undefined\` stores).
function update(o: Options, label: string | undefined): void {
  const count: number = (o.count ?? 0) + 1;
  o.count = count;
  if (o.enabled === undefined) {
    const enabled: boolean = true;
    o.enabled = enabled;
  }
  const next: string = label === undefined ? "added" : label + "!";
  o.label = next;
}
function extend(o: Options): void {
  const a: boolean = o.a !== true;
  o.a = a;
  if (o.child === undefined) {
    const child: Options = { id: o.id + 100 };
    o.child = child;
  }
  const i: number = o.id;
  o.i = i;
}
function options(rounds: number): number {
  let total = 0;
  const all: Options[] = [];
  for (let i = 0; i < rounds; i++) {
    const o: Options = { id: i };
    if (i % 2 === 0) o.count = i;
    if (i % 3 === 0) o.enabled = i % 6 === 0;
    if (i % 5 === 0) o.label = "l" + String(i);
    if (i % 7 === 0) o.child = { id: -i, h: true };
    if (i % 4 === 1) o.a = true;
    if (i % 4 === 2) o.h = false;
    if (i % 9 === 0) o.i = i / 2;
    all.push(o);
  }
  for (let round = 0; round < 3; round++) {
    // Allocate enough to move the objects between rounds.
    let garbage: number[][] = [];
    for (let i = 0; i < 2000; i++) garbage.push([i, i + 1, i + 2]);
    total = mix(total, garbage.length);
    garbage = [];
    for (let k = 0; k < all.length; k++) {
      const o = all[k];
      if (o === undefined) continue;
      total = mix(total, o.id);
      total = mix(total, o.count ?? -1);
      total = mix(total, o.enabled === undefined ? 2 : o.enabled ? 1 : 0);
      const label = o.label,
        child = o.child;
      total = mix(total, label === undefined ? 0 : hash(label));
      total = mix(total, child === undefined ? 0 : child.id + (child.h ? 7 : 3));
      total = mix(total, (o.a === true ? 1 : 0) + (o.h === false ? 2 : 0));
      total = mix(total, o.i ?? 9);
      // Clear and re-add between rounds.
      // Later rounds set absent fields and overwrite present ones (the
      // typed path has no \`delete\` or \`undefined\` stores).
      if (round === 0) update(o, label);
      else if (round === 1) extend(o);
    }
  }
  return total;
}
export function checksum(): number {
  let total = 0;
  const nodes: Node[] = [];
  for (let i = 0; i < 300; i++) nodes.push(make(i));
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node === undefined) continue;
      total = mix(total, evaluate(node));
      total = mix(total, hash(kindOf(node)));
      total = mix(total, aliased(node));
      total = mix(total, spread(node));
      total = mix(total, narrowed(node));
      total = mix(total, hash(maybeKind(i % 10 === 0 ? undefined : node)));
      if (node.kind === "lit")
        total = mix(total, node.flag === undefined ? 3 : node.flag ? 1 : 0);
      if (node.kind === "call") total = mix(total, node.args.length);
    }
    // Allocation between rounds moves the nodes.
    const garbage: Node[] = [];
    for (let i = 0; i < 3000; i++) garbage.push(make(i));
    total = mix(total, garbage.length);
  }
  total = mix(total, sides());
  total = mix(total, tags(40, "tag"));
  total = mix(total, options(120));
  return total;
}
`;

async function expectedChecksum(text: string): Promise<number> {
  const directory = mkdtempSync(join(tmpdir(), "tint-record-packing-"));
  try {
    const file = join(directory, "fixture.ts");
    writeFileSync(file, text);
    const module = (await import(pathToFileURL(file).href)) as {
      checksum(): number;
    };
    return module.checksum();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("packed presence tags and per-offset union dispatch keep ECMAScript semantics", async () => {
  const expected = await expectedChecksum(source);
  assert.equal(typeof expected, "number");
  verifyHostedFixture(
    source +
      `export function run(): number { return checksum() === ${expected} ? 42 : 1; }\n`,
    "record-packing",
    [],
    [],
    [],
    [],
    {
      runtimeEntry: "initializeGenerationalRuntime",
      managedBytes: 16777216,
      allocationCapacity: 262144,
      rootCapacity: 65536,
    },
  );
});
