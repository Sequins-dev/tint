import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import * as compiler from "../src/native/index.ts";
import type { NativeManagedPointerImport } from "@tint/codegen/aarch64/scalar";
function fixture(withRuntimes = false) {
  const parsed = parseModule(
    createSourceTextView(
      "interface Link{readonly value:number;readonly next:Link|undefined;}function keep(value:Link):Link{return value;}function visit(value:Link,read:(value:Link)=>number):number{return read(value);}",
    ),
  );
  assert.ok(parsed.ok);
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok);
  const described = compiler.reifyManagedSurfaceTypes(
    checked.value,
    [
      { name: "keep", local: "keep" },
      { name: "visit", local: "visit" },
    ],
    "$Types",
  );
  assert.ok(described.ok);
  const canonical = compiler.canonicalizeManagedSurfaceTypes(described.value);
  assert.ok(canonical.ok);
  const facts = compiler.deriveManagedSurfacePhysicalFacts(canonical.value, {
    modules: [],
    runtimes: [],
    globals: ["undefined"],
  });
  assert.ok(facts.ok);
  const prepared = compiler.createManagedSurfaceDirectory(
    "reader",
    canonical.value,
    {
      ...facts.value,
      runtimes: withRuntimes
        ? [
            {
              kind: "number-text",
              element: "",
              value: "",
              operations: [
                {
                  operation: "toString",
                  parameters: ["number"],
                  returnType: "string",
                },
                {
                  operation: "fromString",
                  parameters: ["string"],
                  returnType: "number",
                },
              ],
            },
          ]
        : [],
    },
  );
  assert.ok(prepared.ok);
  const count =
    canonical.value.entries.length + prepared.value.witnesses.length;
  const functions: readonly unknown[] = Array.from(
    { length: count },
    () => () => 42,
  );
  const records = new Float64Array(
    prepared.value.directory.records.map((_, index) => 0x4000 + index * 1024),
  );
  const events: string[] = [];
  const host = {
    domain: () => {
      events.push("domain");
      return 17;
    },
    descriptor: (_fn: unknown) => {
      events.push("descriptor");
      return 0x1000;
    },
    signature: (fn: unknown) => {
      events.push("signature");
      return 0x2000 + functions.indexOf(fn) * 64;
    },
  };
  return {
    exported: {
      directory: prepared.value.directory,
      table: {},
      functions,
      records,
      entries: new Float64Array(
        withRuntimes ? [0x800004, 0x900000, 0x800008, 0x900080] : [],
      ),
    },
    events,
    host,
  };
}
function digest(
  directory: compiler.SerializedManagedSurfaceDirectory,
): compiler.SerializedManagedSurfaceDirectory {
  const result = compiler.digestManagedSurfaceDirectory(directory);
  assert.ok(result.ok);
  return { ...directory, digest: result.value };
}
test("directory readers rebuild canonical contracts before issuing domain-owned bindings", () => {
  assert.equal(typeof compiler.readManagedSurfaceDirectory, "function");
  const { exported, events, host } = fixture();
  const result = compiler.readManagedSurfaceDirectory(exported, "reader", host);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.domain, 17);
  assert.deepEqual(result.value.directory, exported.directory);
  assert.notEqual(result.value.directory, exported.directory);
  assert.equal(events[0], "domain");
  assert.equal(events.at(-1), "domain");
  assert.equal(
    events.filter((event) => event === "signature").length,
    exported.directory.signatures.length,
  );
  assert.equal(result.value.brand.byteLength, 32);
  assert.equal(result.value.brand.domain, 17);
  assert.equal(result.value.records.length, exported.directory.records.length);
  for (const [index, binding] of result.value.records.entries()) {
    const record = exported.directory.records[index]!;
    assert.equal(
      binding.byteLength,
      compiler.managedIdentityByteLength({
        role: "record",
        recordLayout: record.layout,
        parameters: [],
        returnType: undefined,
      }),
    );
    assert.equal(binding.address, exported.records[index]);
    assert.equal(binding.domain, 17);
  }
});
test("malformed directories and export counts fail before every host leaf", () => {
  const { exported, events, host } = fixture();
  const directory = exported.directory;
  const invalid = [
    {
      ...exported,
      directory: { ...directory, version: directory.version + 1 },
    },
    { ...exported, directory: { ...directory, name: "foreign" } },
    { ...exported, directory: { ...directory, digest: "0".repeat(64) } },
    {
      ...exported,
      directory: digest({
        ...directory,
        abi: { ...directory.abi, signature: 999 },
      }),
    },
    {
      ...exported,
      directory: digest({
        ...directory,
        signatures: directory.signatures.slice().reverse(),
      }),
    },
    {
      ...exported,
      directory: digest({ ...directory, records: directory.records.slice(1) }),
    },
    {
      ...exported,
      directory: digest({
        ...directory,
        signatures: directory.signatures.map((entry, index) =>
          index === 0 ? { ...entry, function: 999 } : entry,
        ),
      }),
    },
    { ...exported, functions: exported.functions.slice(1) },
    { ...exported, records: exported.records.slice(1) },
    { ...exported, records: new Float64Array(exported.records.map(() => 0)) },
  ];
  for (const input of invalid) {
    events.length = 0;
    const result = compiler.readManagedSurfaceDirectory(input, "reader", host);
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.deepEqual(events, []);
  }
});
test("directory readers reject unissued, changing or unavailable host identities", () => {
  const { exported, host } = fixture();
  for (const candidate of [
    { ...host, domain: () => 0 },
    { ...host, descriptor: () => -1 },
    { ...host, signature: () => -1 },
    { ...host, signature: () => 0x2001 },
  ])
    assert.equal(
      compiler.readManagedSurfaceDirectory(exported, "reader", candidate).ok,
      false,
    );
  let calls = 0;
  const changed = compiler.readManagedSurfaceDirectory(exported, "reader", {
    ...host,
    domain: () => (++calls === 1 ? 17 : 18),
  });
  assert.equal(changed.ok, false);
  if (!changed.ok) assert.match(changed.error, /domain changed/);
  let descriptors = 0;
  const foreign = compiler.readManagedSurfaceDirectory(exported, "reader", {
    ...host,
    descriptor: () => (++descriptors === 1 ? 0x1000 : 0x1800),
  });
  assert.equal(foreign.ok, false);
  if (!foreign.ok) assert.match(foreign.error, /foreign function brand/);
});

test("binding selection uses exact contracts and importing names, without invoking leaves", () => {
  assert.equal(typeof compiler.selectManagedIdentityBindings, "function");
  const { exported, events, host } = fixture(true);
  const result = compiler.readManagedSurfaceDirectory(exported, "reader", host);
  assert.ok(result.ok);
  const read = result.value;
  events.length = 0;
  const pool = [
    read.brand,
    ...read.signatures,
    ...read.records,
    ...read.runtimes,
  ];
  const imports: NativeManagedPointerImport[] = pool.map((binding, index) => ({
    role: binding.role,
    name: "symbol" + index,
    contract: binding.contract,
    offset: index * 8,
    byteLength: 8,
    witness: binding.role === "function-brand" ? undefined : 0,
    parameters: binding.parameters,
    returnType: binding.returnType,
    recordLayout: binding.recordLayout,
  }));
  const selected = compiler.selectManagedIdentityBindings(read, imports);
  assert.ok(selected.ok, JSON.stringify(selected));
  assert.deepEqual(
    selected.value.map((binding) => binding.name),
    imports.map((item) => item.name),
  );
  assert.deepEqual(
    selected.value.map((binding) => binding.address),
    pool.map((binding) => binding.address),
  );
  assert.deepEqual(events, []);
  const first = imports[0]!;
  for (const invalid of [
    [{ ...first, contract: "unissued" }],
    [first, first],
    [{ ...first, parameters: ["number" as const] }],
    [{ ...first, role: "signature" as const }],
    [{ ...first, name: "" }],
  ])
    assert.equal(
      compiler.selectManagedIdentityBindings(read, invalid).ok,
      false,
    );
  assert.deepEqual(compiler.selectManagedIdentityBindings(read, []), {
    ok: true,
    value: [],
  });
});

test("a recomputed digest establishes consistency rather than export provenance", () => {
  const { exported, host } = fixture();
  const changed = digest({
    ...exported.directory,
    records: exported.directory.records.map((record, index) =>
      index === 0
        ? {
            ...record,
            layout: {
              ...record.layout,
              fields: record.layout.fields.map((field, fieldIndex) =>
                fieldIndex === 0
                  ? { ...field, mutable: !field.mutable }
                  : field,
              ),
            },
          }
        : record,
    ),
  });
  assert.notEqual(changed.digest, exported.directory.digest);
  const result = compiler.readManagedSurfaceDirectory(
    { ...exported, directory: changed },
    "reader",
    host,
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.directory.digest, changed.digest);
  // Only an engine-owned bind-stub export may enter this API. Physical linking
  // and D6 lowering agreement are separate checks, not digest authentication.
});

test("runtime entries are checked completely before any host identity is read", () => {
  const { exported, events, host } = fixture(true);
  const read = compiler.readManagedSurfaceDirectory(exported, "reader", host);
  assert.ok(read.ok, JSON.stringify(read));
  assert.equal(read.value.runtimes.length, 2);
  assert.deepEqual(
    read.value.runtimes.map((binding) => binding.role),
    ["function-entry", "function-entry"],
  );
  assert.deepEqual(
    read.value.runtimes.map((binding) => binding.entry),
    [0x800004, 0x800008],
  );
  assert.deepEqual(
    read.value.runtimes.map((binding) => binding.contract),
    [
      compiler.managedSurfaceContract(
        "reader",
        exported.directory.digest,
        "runtime",
        0,
      ),
      compiler.managedSurfaceContract(
        "reader",
        exported.directory.digest,
        "runtime",
        1,
      ),
    ],
  );
  assert.ok(read.value.runtimes.every((binding) => binding.domain === 17));
  const invalid = [new Float64Array(0), exported.entries.slice(0, 3)];
  for (const word of [0, -4, 1, 0x800002, NaN, Infinity, 2 ** 53]) {
    const entries = exported.entries.slice();
    entries[2] = word;
    invalid.push(entries);
  }
  for (const word of [0, -8, 0x900084, NaN, Infinity, 2 ** 53]) {
    const entries = exported.entries.slice();
    entries[3] = word;
    invalid.push(entries);
  }
  for (const entries of invalid) {
    events.length = 0;
    const result = compiler.readManagedSurfaceDirectory(
      { ...exported, entries },
      "reader",
      host,
    );
    assert.equal(result.ok, false, String(entries));
    assert.deepEqual(events, []);
  }
  const provider = exported.directory.runtimes[0]!;
  for (const runtimes of [
    [{ ...provider, element: "$T999" }],
    [{ ...provider, operations: provider.operations.slice().reverse() }],
    [{ ...provider, operations: [] }],
    [provider, provider],
  ]) {
    events.length = 0;
    const result = compiler.readManagedSurfaceDirectory(
      { ...exported, directory: digest({ ...exported.directory, runtimes }) },
      "reader",
      host,
    );
    assert.equal(result.ok, false);
    assert.deepEqual(events, []);
  }
});

test("surface linking rechecks the live domain and validates every window before patching a copy", () => {
  const { exported, host } = fixture(true);
  const read = compiler.readManagedSurfaceDirectory(exported, "reader", host);
  assert.ok(read.ok);
  const binding = read.value.runtimes[0]!;
  const request: NativeManagedPointerImport = {
    role: "function-entry",
    name: "runtimeCall",
    contract: binding.contract,
    offset: 0,
    byteLength: 8,
    witness: 0,
    parameters: binding.parameters,
    returnType: binding.returnType,
  };
  const native: import("@tint/codegen/aarch64/scalar").NativeModule = {
    linkage: "unresolved-managed",
    managedImports: [request],
    functionDescriptor: undefined,
    functionDescriptorImport: undefined,
    code: new Uint8Array(8),
    functions: [],
    records: [],
    roots: [],
    strings: [],
    signatures: [],
    helpers: [],
    cellHelpers: [],
    imports: [],
    sourceRanges: [],
  };
  let reads = 0;
  const reader = (address: number, length: number, offset: number) => {
    reads++;
    assert.equal(address, binding.address);
    assert.equal(length, 40);
    return [1, 40, 1, 4, 8][offset / 8]!;
  };
  const foreign = compiler.linkManagedSurfaceModule(
    read.value,
    native,
    reader,
    18,
  );
  assert.equal(foreign.ok, false);
  assert.equal(reads, 0);
  const missing = compiler.linkManagedSurfaceModule(
    read.value,
    { ...native, managedImports: [{ ...request, contract: "unknown" }] },
    reader,
    17,
  );
  assert.equal(missing.ok, false);
  assert.equal(reads, 0);
  const bad = compiler.linkManagedSurfaceModule(
    read.value,
    native,
    () => {
      reads++;
      return 0;
    },
    17,
  );
  assert.equal(bad.ok, false);
  assert.ok(reads > 0);
  assert.deepEqual([...native.code], Array(8).fill(0));
  reads = 0;
  const linked = compiler.linkManagedSurfaceModule(
    read.value,
    native,
    reader,
    17,
  );
  assert.ok(linked.ok, JSON.stringify(linked));
  assert.equal(reads, 5);
  assert.equal(
    new DataView(linked.value.code.buffer).getBigUint64(0, true),
    BigInt(binding.entry!),
  );
  assert.deepEqual([...native.code], Array(8).fill(0));
});
