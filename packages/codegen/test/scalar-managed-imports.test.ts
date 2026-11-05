import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encode,
  relativeAddress,
  type Instruction,
} from "@tint/codegen/aarch64/isa";
import type { ModuleIR } from "@tint/ir/scalar";
import {
  emitModule,
  type EmissionOptions,
} from "../src/aarch64/scalar/index.ts";
const span = { start: 0, end: 0 };
function fixture(local = false): ModuleIR {
  const body = (id: number) => ({
    id,
    name: "witness" + id,
    exported: false,
    parameters: [],
    slots: [],
    returnType: "number" as const,
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant" as const, id: 0, value: 42, ...span },
        ],
        terminator: { kind: "return" as const, value: 0, ...span },
      },
    ],
  });
  return {
    functions: [
      {
        id: 0,
        name: "entry",
        exported: true,
        parameters: [0],
        slots: ["reference"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              ...(local
                ? [{ kind: "function-new" as const, id: 2, target: 2, ...span }]
                : []),
              {
                kind: "call-indirect",
                id: 1,
                target: 1,
                callee: 0,
                arguments: [],
                ...span,
              },
            ],
            terminator: { kind: "return", value: 1, ...span },
          },
        ],
      },
      body(1),
      ...(local ? [body(2)] : []),
    ],
  };
}
function request() {
  return {
    version: 1 as const,
    functionBrand: {
      name: "aot.functions",
      contract: "tint.function-object.v1",
    },
    signatures: [
      {
        witness: 1,
        name: "aot.read",
        contract: "tint.test.read.v1",
        parameters: [] as const,
        returnType: "number" as const,
      },
    ],
  };
}
function word(i: Instruction) {
  const r = encode(i);
  assert.ok(r.ok);
  return r.value;
}
function addressMatches(
  view: DataView,
  at: number,
  rd: number,
  target: number,
) {
  const s = relativeAddress(rd, 17, target - at);
  assert.ok(s.ok);
  return s.value.every((i, n) => view.getUint32(at + n * 4, true) === word(i));
}
test("symbolic managed imports retain zero full-width slots and explicit unresolved roles", () => {
  const r = emitModule(fixture(), { managedABI: request() });
  assert.ok(r.ok, JSON.stringify(r));
  const n = r.value;
  assert.equal(n.linkage, "unresolved-managed");
  assert.equal(n.functionDescriptor, undefined);
  assert.equal(n.functionDescriptorImport?.role, "function-brand");
  assert.deepEqual(
    n.managedImports.map((i) => [i.role, i.name, i.contract]),
    [
      ["function-brand", "aot.functions", "tint.function-object.v1"],
      ["signature", "aot.read", "tint.test.read.v1"],
    ],
  );
  const view = new DataView(n.code.buffer, n.code.byteOffset, n.code.length);
  for (const i of n.managedImports) {
    assert.equal(i.offset % 8, 0);
    assert.equal(i.byteLength, 8);
    assert.equal(view.getBigUint64(i.offset, true), 0n);
    const rd = i.role === "function-brand" ? 11 : 11;
    let count = 0;
    for (let p = 0; p + 20 <= n.functions[0]!.byteLength; p += 4)
      if (
        addressMatches(view, p, rd, i.offset) &&
        view.getUint32(p + 16, true) ===
          word({ op: "ldr", width: 64, rt: rd, rn: rd, offset: 0 })
      )
        count++;
    assert.equal(count, 1);
  }
  const signature = n.managedImports[1]!;
  assert.equal(signature.witness, 1);
  assert.deepEqual(signature.parameters, []);
  assert.equal(signature.returnType, "number");
  assert.deepEqual(n.signatures, []);
});
test("imported witnesses do not replace physically equivalent private signature identities", () => {
  const r = emitModule(fixture(true), { managedABI: request() });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(
    r.value.signatures.map((s) => s.functions),
    [[2]],
  );
});
test("managed ABI rejects invalid, duplicate, missing and mismatched contracts", () => {
  const base = request();
  const cases = [
    { ...base, version: 2 },
    { ...base, functionBrand: undefined },
    {
      ...base,
      functionBrand: { name: "", contract: "tint.function-object.v1" },
    },
    { ...base, signatures: [{ ...base.signatures[0]!, witness: 99 }] },
    {
      ...base,
      signatures: [
        base.signatures[0]!,
        { ...base.signatures[0]!, name: "other" },
      ],
    },
    {
      ...base,
      signatures: [{ ...base.signatures[0]!, name: base.functionBrand.name }],
    },
    {
      ...base,
      signatures: [{ ...base.signatures[0]!, parameters: ["number"] }],
    },
    {
      ...base,
      signatures: [{ ...base.signatures[0]!, returnType: "reference" }],
    },
    { ...base, signatures: [{ ...base.signatures[0]!, contract: "" }] },
  ];
  for (const c of cases) {
    const r = emitModule(fixture(), { managedABI: c } as EmissionOptions);
    assert.equal(r.ok, false, JSON.stringify(c));
  }
  const m = fixture(true),
    entry = m.functions[0]!;
  const forbidden = {
    ...m,
    functions: [
      {
        ...entry,
        blocks: [
          {
            ...entry.blocks[0]!,
            instructions: entry.blocks[0]!.instructions.map((i) =>
              i.kind === "function-new" ? { ...i, target: 1 } : i,
            ),
          },
        ],
      },
      ...m.functions.slice(1),
    ],
  };
  assert.equal(emitModule(forbidden, { managedABI: base }).ok, false);
  const unused = {
    ...base,
    signatures: [
      {
        ...base.signatures[0]!,
        witness: 0,
        parameters: ["reference"],
        returnType: "number",
      },
    ],
  };
  assert.equal(
    emitModule(fixture(), { managedABI: unused } as EmissionOptions).ok,
    false,
  );
});
test("managed slots respect exact emission budgets and local modules stay resolved", () => {
  const r = emitModule(fixture(), { managedABI: request() });
  assert.ok(r.ok);
  const size = r.value.code.length;
  assert.ok(
    emitModule(fixture(), { managedABI: request(), maxByteLength: size }).ok,
  );
  assert.equal(
    emitModule(fixture(), { managedABI: request(), maxByteLength: size - 1 })
      .ok,
    false,
  );
  const local = emitModule(fixture());
  assert.ok(local.ok);
  assert.equal(local.value.linkage, "local");
  assert.deepEqual(local.value.managedImports, []);
  assert.equal(local.value.functionDescriptorImport, undefined);
});

test("canonical function brand is loaded consistently for creation, environment, indirect call and typeof", () => {
  const m = fixture(true),
    f = m.functions[0]!,
    block = f.blocks[0]!;
  const r = emitModule(
    {
      ...m,
      functions: [
        {
          ...f,
          blocks: [
            {
              ...block,
              instructions: [
                { kind: "load", id: 0, slot: 0, ...span },
                { kind: "function-new", id: 2, target: 2, ...span },
                { kind: "function-environment", id: 3, callee: 2, ...span },
                { kind: "general-wrap", id: 4, value: 2, ...span },
                { kind: "general-kind", id: 5, value: 4, ...span },
                {
                  kind: "call-indirect",
                  id: 1,
                  target: 1,
                  callee: 0,
                  arguments: [],
                  ...span,
                },
              ],
            },
          ],
        },
        ...m.functions.slice(1),
      ],
    },
    { managedABI: request() },
  );
  assert.ok(r.ok, JSON.stringify(r));
  const n = r.value,
    slot = n.functionDescriptorImport!;
  let loads = 0;
  const view = new DataView(n.code.buffer, n.code.byteOffset, n.code.length),
    entry = n.functions[0]!;
  for (let p = entry.offset; p + 20 <= entry.offset + entry.byteLength; p += 4)
    if (
      addressMatches(view, p, 11, slot.offset) &&
      view.getUint32(p + 16, true) ===
        word({ op: "ldr", width: 64, rt: 11, rn: 11, offset: 0 })
    )
      loads++;
  assert.equal(loads, 4);
});
test("canonical typeof recognizes function brands even in a general-kind-only module", () => {
  const r = emitModule(
    {
      functions: [
        {
          id: 0,
          name: "type",
          exported: true,
          parameters: [0],
          slots: ["general"],
          returnType: "string",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "load", id: 0, slot: 0, ...span },
                { kind: "general-kind", id: 1, value: 0, ...span },
              ],
              terminator: { kind: "return", value: 1, ...span },
            },
          ],
        },
      ],
    },
    { managedABI: { ...request(), signatures: [] } },
  );
  assert.ok(r.ok, JSON.stringify(r));
  const n = r.value,
    slot = n.functionDescriptorImport!;
  assert.ok(slot);
  const view = new DataView(n.code.buffer, n.code.byteOffset, n.code.length);
  let load = false;
  for (let p = 0; p + 20 <= n.functions[0]!.byteLength; p += 4)
    if (
      addressMatches(view, p, 11, slot.offset) &&
      view.getUint32(p + 16, true) ===
        word({ op: "ldr", width: 64, rt: 11, rn: 11, offset: 0 })
    )
      load = true;
  assert.equal(load, true);
});
test("managed witness parameter order and scalar encodings remain exact", () => {
  const m = fixture(),
    first = m.functions[0]!,
    second = m.functions[1]!;
  const module: ModuleIR = {
    functions: [
      {
        ...first,
        parameters: [0, 1, 2],
        slots: ["reference", "reference", "string"],
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "load", id: 1, slot: 1, ...span },
              { kind: "load", id: 2, slot: 2, ...span },
              {
                kind: "call-indirect",
                id: 3,
                target: 1,
                callee: 0,
                arguments: [1, 2],
                ...span,
              },
            ],
            terminator: { kind: "return", value: 3, ...span },
          },
        ],
      },
      { ...second, parameters: [0, 1], slots: ["reference", "string"] },
    ],
  };
  for (const types of [
    ["reference", "string"],
    ["string", "reference"],
    ["general", "string"],
  ] as const) {
    const base = request();
    const r = emitModule(module, {
      managedABI: {
        ...base,
        signatures: [{ ...base.signatures[0]!, parameters: types }],
      },
    });
    assert.equal(r.ok, types[0] === "reference", JSON.stringify(r));
  }
});

test("witness indexes and symbolic names are bounded without consuming runtime addresses", () => {
  const base = request();
  for (const witness of [-1, 1.5, NaN, Infinity])
    assert.equal(
      emitModule(fixture(), {
        managedABI: {
          ...base,
          signatures: [{ ...base.signatures[0]!, witness }],
        },
      }).ok,
      false,
    );
  for (const name of ["", "x\0y"])
    assert.equal(
      emitModule(fixture(), {
        managedABI: { ...base, signatures: [{ ...base.signatures[0]!, name }] },
      }).ok,
      false,
    );
  const withAddress = {
    ...base,
    functionBrand: { ...base.functionBrand, address: 123456789 },
    signatures: [{ ...base.signatures[0]!, address: 987654321 }],
  };
  const r = emitModule(fixture(), { managedABI: withAddress });
  assert.ok(r.ok);
  assert.equal(r.value.linkage, "unresolved-managed");
  const v = new DataView(
    r.value.code.buffer,
    r.value.code.byteOffset,
    r.value.code.length,
  );
  for (const slot of r.value.managedImports)
    assert.equal(v.getBigUint64(slot.offset, true), 0n);
});
test("private record construction retains a local descriptor beside canonical function brands", () => {
  const m = fixture(true),
    entry = m.functions[0]!,
    b = entry.blocks[0]!;
  const r = emitModule(
    {
      ...m,
      records: [
        {
          byteLength: 48,
          fields: [{ offset: 24, type: "optional-reference", mutable: false }],
        },
      ],
      functions: [
        {
          ...entry,
          blocks: [
            {
              ...b,
              instructions: [
                { kind: "reference-none", id: 6, ...span },
                {
                  kind: "record-new",
                  id: 7,
                  record: 0,
                  arguments: [6],
                  ...span,
                },
                ...b.instructions,
              ],
            },
          ],
        },
        ...m.functions.slice(1),
      ],
    },
    { managedABI: request() },
  );
  assert.ok(r.ok, JSON.stringify(r));
  const n = r.value,
    v = new DataView(n.code.buffer, n.code.byteOffset, n.code.length);
  let local = false;
  for (let p = 0; p + 20 <= n.functions[0]!.byteLength; p += 4)
    if (
      addressMatches(v, p, 11, n.records[0]!.offset) &&
      v.getUint32(p + 16, true) ===
        word({ op: "str", width: 64, rt: 11, rn: 9, offset: 0 })
    )
      local = true;
  assert.equal(local, true);
  assert.equal(n.functionDescriptor, undefined);
});

test("explicit local signature membership shares canonical metadata for construction and calls", () => {
  const managed = request();
  const result = emitModule(fixture(true), {
    managedABI: {
      ...managed,
      signatures: [{ ...managed.signatures[0]!, localFunctions: [2] }],
    },
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(
    result.value.signatures,
    [],
    "approved local callback must not retain an incompatible private signature",
  );
  const slot = result.value.managedImports.find(
    (item) => item.role === "signature",
  );
  assert.ok(slot);
  const view = new DataView(
    result.value.code.buffer,
    result.value.code.byteOffset,
    result.value.code.byteLength,
  );
  const entry = result.value.functions[0]!;
  let canonicalStore = 0;
  for (let p = entry.offset; p + 20 <= entry.offset + entry.byteLength; p += 4)
    if (
      addressMatches(view, p, 10, slot.offset) &&
      view.getUint32(p + 16, true) ===
        word({ op: "ldr", width: 64, rt: 10, rn: 10, offset: 0 })
    )
      canonicalStore++;
  assert.equal(canonicalStore, 1);
});
test("local signature membership requires distinct valid targets and exact physical signatures", () => {
  for (const localFunctions of [[1], [2, 2], [-1], [99]]) {
    const managed = request();
    assert.equal(
      emitModule(fixture(true), {
        managedABI: {
          ...managed,
          signatures: [{ ...managed.signatures[0]!, localFunctions }],
        },
      }).ok,
      false,
      JSON.stringify(localFunctions),
    );
  }
  const module = fixture(true),
    local = module.functions[2]!;
  const mismatched = {
    ...module,
    functions: [
      ...module.functions.slice(0, 2),
      { ...local, parameters: [0], slots: ["number" as const] },
    ],
  };
  const managed = request();
  assert.equal(
    emitModule(mismatched, {
      managedABI: {
        ...managed,
        signatures: [{ ...managed.signatures[0]!, localFunctions: [2] }],
      },
    }).ok,
    false,
  );
});

test("local semantic groups cannot replace imported signature authority", () => {
  const base = request();
  const inherited = {
    ...base,
    signatures: [{ ...base.signatures[0]!, localFunctions: [2] }],
  };
  for (const [managedABI, localSignatures] of [
    [base, [{ name: "local", contract: "local.v1", functions: [1] }]],
    [inherited, [{ name: "local", contract: "local.v1", functions: [2] }]],
    [base, [{ name: "aot.read", contract: "local.v1", functions: [2] }]],
    [base, [{ name: "local", contract: "tint.test.read.v1", functions: [2] }]],
  ] as const) {
    const result = emitModule(fixture(true), { managedABI, localSignatures });
    assert.equal(result.ok, false);
  }
  const independent = emitModule(fixture(true), {
    managedABI: base,
    localSignatures: [{ name: "local", contract: "local.v1", functions: [2] }],
  });
  assert.ok(independent.ok, JSON.stringify(independent));
  assert.equal(
    independent.value.signatures.find((signature) =>
      signature.functions.includes(2),
    )?.identity?.contract,
    "local.v1",
  );
});

test("explicit callback members import a signature without an indirect-call witness", () => {
  const original = fixture(true),
    entry = original.functions[0]!,
    member = original.functions[2]!;
  const module: ModuleIR = {
    functions: [
      {
        ...entry,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "function-new", id: 0, target: 1, ...span },
              { kind: "constant", id: 1, value: 42, ...span },
            ],
            terminator: { kind: "return", value: 1, ...span },
          },
        ],
      },
      { ...member, id: 1 },
    ],
  };
  const base = request();
  const binding = {
    name: "aot.callback",
    contract: "tint.callback.v1",
    localFunctions: [1],
    parameters: [],
    returnType: "number",
  } as const;
  const emitted = emitModule(module, {
    managedABI: { ...base, signatures: [binding] },
  });
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const imported = emitted.value.managedImports.find(
    (item) => item.role === "signature",
  );
  assert.ok(imported);
  assert.equal(imported.witness, 1);
  assert.deepEqual(imported.parameters, []);
  assert.deepEqual(emitted.value.signatures, []);
  for (const localFunctions of [[], [99], [1, 1]]) {
    const invalid = emitModule(module, {
      managedABI: { ...base, signatures: [{ ...binding, localFunctions }] },
    });
    assert.equal(invalid.ok, false, JSON.stringify(localFunctions));
  }
});
