import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import {
  parseModule,
  rewriteModule,
  type Module,
} from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import {
  reifyManagedSurfaceTypes,
  adaptManagedSurfaceEntry,
} from "../src/native/index.ts";
import * as applications from "../src/native/managed-applications.ts";
function parse(text: string): Module {
  const p = parseModule(createSourceTextView(text));
  assert.ok(p.ok, JSON.stringify(p));
  return p.value;
}
function surface() {
  const checked = checkClosureModule(
    parse(
      "interface Box{readonly value:unknown;}function create(value:unknown):Box{return {value};}",
    ),
  );
  assert.ok(checked.ok);
  const surface = reifyManagedSurfaceTypes(
    checked.value,
    [{ name: "create", local: "create" }],
    "$Surface",
    [{ name: "Box", local: "Box" }],
  );
  assert.ok(surface.ok);
  return surface.value;
}
const specifiers = new Set(["runtime"]),
  registry = new Map([
    ["create", ["unknown"]],
    ["Box", ["unknown"]],
  ]);
test("managed application normalization erases only exact approved imported instantiations", () => {
  const module = parse(
    'import {create as make,type Box as Wrapped} from "runtime";export function execute():unknown{const box:Wrapped<unknown>=make<unknown>(42);return box.value;}',
  );
  const before = JSON.stringify(module),
    result = applications.normalizeManagedSurfaceApplications(
      module,
      specifiers,
      registry,
      surface(),
    );
  assert.ok(result.ok);
  assert.equal(result.value.erased, 2);
  assert.equal(JSON.stringify(module), before);
  const repeated = applications.normalizeManagedSurfaceApplications(
    result.value.module,
    specifiers,
    registry,
    surface(),
  );
  assert.ok(repeated.ok);
  assert.equal(repeated.value.erased, 0);
  assert.deepEqual(repeated.value.module, result.value.module);
  const adapted = adaptManagedSurfaceEntry(
    result.value.module,
    "execute",
    "runtime",
    surface(),
  );
  assert.ok(adapted.ok);
  const checked = checkClosureModule(adapted.value.module);
  assert.ok(checked.ok, JSON.stringify(checked));
});
test("normalization classifies imports by surface membership and rejects wrong registry arguments", () => {
  for (const [source, reason] of [
    [
      'import {Box} from "runtime";function f(v:Box<unknown>):void{}',
      undefined,
    ],
    [
      'import {create} from "runtime";function f(){return create<number>(42);}',
      /instantiation/,
    ],
    ['import type {create} from "runtime";', /binding kind/],
    ['import {absent} from "runtime";', /export is missing/],
    ['import {create} from "other";', /approved/],
    ['import * as runtime from "runtime";', /named/],
  ] as const) {
    const result = applications.normalizeManagedSurfaceApplications(
      parse(source),
      specifiers,
      registry,
      surface(),
    );
    if (reason === undefined) assert.ok(result.ok);
    else {
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, reason);
    }
  }
  const nongeneric = applications.normalizeManagedSurfaceApplications(
    parse(
      'import {create} from "runtime";function f(){return create<unknown>(42);}',
    ),
    specifiers,
    new Map(),
    surface(),
  );
  assert.equal(nongeneric.ok, false);
});
test("local generic calls and shadowed imported value or type names retain their arguments", () => {
  const module = parse(
    'import {create as make,type Box as Wrapped} from "runtime";function local<T>(value:T):T{return value;}function shadow(make:(value:number)=>number):number{return make<number>(42);}function typed():number{type Wrapped<T>={value:T};const local:Wrapped<number>={value:42};return local.value;}export function execute():unknown{const box:Wrapped<unknown>=make<unknown>(local<number>(42));return box.value;}',
  );
  const result = applications.normalizeManagedSurfaceApplications(
    module,
    specifiers,
    registry,
    surface(),
  );
  assert.ok(result.ok);
  assert.equal(result.value.erased, 2);
  const calls: string[] = [],
    types: string[] = [];
  rewriteModule(result.value.module, {
    expression: (node) => {
      if (
        node.kind === "call" &&
        node.callee.kind === "identifier" &&
        (node.typeArguments?.length ?? 0) > 0
      )
        calls.push(node.callee.name);
      return node;
    },
    type: (node) => {
      if (node.kind === "named" && (node.arguments?.length ?? 0) > 0)
        types.push(node.name);
      return node;
    },
  });
  assert.deepEqual(calls, ["make", "local"]);
  assert.deepEqual(types, ["Wrapped"]);
});
