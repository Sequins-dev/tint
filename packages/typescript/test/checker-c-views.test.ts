// C views (docs/native-ffi.md, "C views"): nominal view types over binding
// records, checked against a registry like the one the compiler builds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import {
  checkClosureModule,
  type CViewMember,
  type CViewRegistry,
  type CViewShape,
  type CViewUse,
} from "@tint/typescript/checker";

function scalar(
  name: string,
  offset: number,
  size: number,
  type: string,
): CViewMember {
  return {
    name,
    offset,
    size,
    value: type === "bool" ? "boolean" : "number",
    scalar: type,
    view: "",
  };
}
const point: CViewShape = {
  size: 8,
  length: 0,
  members: [scalar("x", 0, 4, "i32"), scalar("y", 4, 4, "i32")],
};
const words: CViewShape = {
  size: 8,
  length: 4,
  members: [],
  element: scalar("", 0, 2, "u16"),
};
const outer: CViewShape = {
  size: 24,
  length: 0,
  members: [
    scalar("tag", 0, 1, "u8"),
    {
      name: "origin",
      offset: 4,
      size: 8,
      value: "view",
      scalar: "",
      view: "m#Point",
    },
    {
      name: "words",
      offset: 12,
      size: 8,
      value: "view",
      scalar: "",
      view: "m#Outer.words",
    },
    scalar("flag", 20, 1, "bool"),
  ],
};
const registry: CViewRegistry = {
  viewType: "View",
  records: new Map([
    ["Point", "m#Point"],
    ["Outer", "m#Outer"],
  ]),
  layouts: new Map([
    ["Point", "m#Point"],
    ["Outer", "m#Outer"],
  ]),
  foreign: new Map<string, "view" | "array">([
    ["viewAt", "view"],
    ["arrayAt", "array"],
  ]),
  shapes: new Map([
    ["m#Point", point],
    ["m#Outer", outer],
    ["m#Outer.words", words],
  ]),
};
const prelude = `type View<T> = Uint8Array;
interface Point { x: number; y: number }
interface Outer { tag: number; origin: Point; words: number[]; flag: boolean }
const Point = { size: 8, alignment: 4 };
const Outer = { size: 24, alignment: 4 };
interface RecordLayout { readonly size: number }
function viewAt(layout: RecordLayout, address: number): Uint8Array {
  return new Uint8Array(layout.size + address * 0);
}
function arrayAt(layout: RecordLayout, address: number, count: number): Uint8Array[] {
  const views: Uint8Array[] = [];
  for (let i = 0; i < count; i++) views.push(new Uint8Array(layout.size + address * 0));
  return views;
}
`;
function check(body: string) {
  const text = prelude + body,
    bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return checkClosureModule(parsed.value, { cViews: registry });
}
function rejected(body: string, message: RegExp): void {
  const result = check(body);
  assert.equal(result.ok, false, body);
  if (!result.ok) assert.match(result.error.message, message, body);
}

test("views read and write members, nested views, elements and length", () => {
  const result = check(`
function origin(outer: View<Outer>): View<Point> { return outer.origin; }
export function run(bytes: Uint8Array): number {
  const outer = Outer.view(bytes);
  outer.tag = 3;
  outer.origin.x += 2;
  outer.words[1]++;
  outer.flag ||= true;
  const point: View<Point> = origin(outer);
  return outer.tag + point.y + outer.words[0] + outer.words.length;
}
`);
  assert.ok(result.ok, JSON.stringify(!result.ok && result.error));
  const uses: CViewUse[] = [];
  result.value.cViewUses.forEach((use) => uses.push(use));
  const kinds = uses.map((use) => use.kind + ":" + use.view).sort();
  assert.ok(kinds.includes("new:m#Outer"));
  assert.ok(kinds.includes("length:m#Outer.words"));
  assert.ok(kinds.includes("element:m#Outer.words"));
  assert.ok(kinds.includes("member:m#Point"));
  // A created view is a nominal Uint8Array of its record.
  const created = uses.find((use) => use.kind === "new");
  assert.deepEqual([created?.size, created?.length], [24, 0]);
  assert.ok(
    result.value.types.some(
      (type) => type.kind === "Uint8Array" && type.view === "m#Point",
    ),
  );
});

test("views are nominal: only R.view makes one and a view is bytes", () => {
  // A plain byte array, or another record's view, is not a view.
  rejected(
    `function f(p: View<Point>): number { return p.x; }
export function run(bytes: Uint8Array): number { return f(bytes); }`,
    /invalid call/,
  );
  rejected(
    `function f(p: View<Point>): number { return p.x; }
export function run(bytes: Uint8Array): number { return f(Outer.view(bytes)); }`,
    /invalid call/,
  );
  // A view passes wherever bytes are expected (a Ptr<R> argument).
  assert.ok(
    check(`function c(bytes: Uint8Array): number { return bytes.length; }
export function run(bytes: Uint8Array): number { return c(Point.view(bytes)); }`)
      .ok,
  );
  // Byte-array operations are not view members.
  rejected(
    `export function run(bytes: Uint8Array): number { return Point.view(bytes).length; }`,
    /no member length/,
  );
  rejected(
    `export function run(bytes: Uint8Array): number { return Point.view(bytes)[0] ?? 0; }`,
    /no member 0/,
  );
  rejected(
    `export function run(bytes: Uint8Array, i: number): number { return Point.view(bytes)[i] ?? 0; }`,
    /literal name/,
  );
  rejected(
    `export function run(bytes: Uint8Array): number { const p = Point.view(bytes); return p.z; }`,
    /no member z/,
  );
  rejected(
    `type Bad = View<number>;\nexport function run(): void {}`,
    /View takes/,
  );
  rejected(
    `export function run(bytes: Uint8Array): void { Point.view(bytes, 1); }`,
    /one byte array/,
  );
});

test("view writes follow member types; nested views are not assignable", () => {
  rejected(
    `export function run(bytes: Uint8Array): void { Point.view(bytes).x = "1"; }`,
    /does not match/,
  );
  rejected(
    `export function run(bytes: Uint8Array): void { Outer.view(bytes).flag = 1; }`,
    /does not match/,
  );
  rejected(
    `export function run(bytes: Uint8Array): void { const o = Outer.view(bytes); o.origin = Point.view(bytes); }`,
    /member by member/,
  );
  rejected(
    `export function run(bytes: Uint8Array): void { Outer.view(bytes).words.length = 2; }`,
    /fixed/,
  );
  rejected(
    `export function run(bytes: Uint8Array): void { Outer.view(bytes).flag += 1; }`,
    /does not match/,
  );
  rejected(
    `export function run(bytes: Uint8Array): void { Outer.view(bytes).words["a"] = 1; }`,
    /does not match/,
  );
});

test("tint:ffi/unsafe record views at addresses are views of the named record", () => {
  const result = check(`
function next(point: View<Point>): number { return point.y; }
export function run(address: number): number {
  const point = viewAt(Point, address);
  point.x = 4;
  const points: View<Point>[] = arrayAt(Point, address, 3);
  const second = points[1];
  if (second === undefined) return -1;
  const outer: View<Outer> = viewAt(Outer, next(second));
  return point.x + second.y + outer.origin.x + points.length;
}
`);
  assert.ok(result.ok, JSON.stringify(!result.ok && result.error));
  assert.ok(
    result.value.types.some(
      (type) =>
        type.kind === "array" &&
        result.value.types[type.element]?.kind === "Uint8Array",
    ),
  );
  // The first argument must name a binding Layout constant, and the result
  // is that record's view only.
  rejected(
    `const other = { size: 8 };
export function run(address: number): number { return viewAt(other, address).length; }`,
    /binding Layout constant/,
  );
  rejected(
    `export function run(address: number): number {
  const outer: View<Outer> = viewAt(Point, address);
  return outer.tag;
}`,
    /invalid binding operation/,
  );
  rejected(
    `export function run(address: number): number { return viewAt(Point, address).z; }`,
    /no member z/,
  );
});
