import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import * as compiler from "../src/native/index.ts";
function fixture() {
  const parsed = parseModule(
    createSourceTextView(
      "interface Link{readonly value:number;readonly next:Link|undefined;readonly label?:string;}interface Frame{readonly imports:unknown;readonly value:Link;}function keep(value:Link):Link{return value;}function visit(value:Link,read:(value:Link)=>number):number{return read(value);}",
    ),
  );
  assert.ok(parsed.ok);
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok, JSON.stringify(checked));
  const described = compiler.reifyManagedSurfaceTypes(
    checked.value,
    [
      { name: "keep", local: "keep" },
      { name: "visit", local: "visit" },
    ],
    "$Source",
    [{ name: "Frame", local: "Frame" }],
  );
  assert.ok(described.ok);
  const canonical = compiler.canonicalizeManagedSurfaceTypes(described.value);
  assert.ok(canonical.ok);
  const facts = compiler.deriveManagedSurfacePhysicalFacts(canonical.value, {
    modules: [],
    runtimes: [],
    globals: ["undefined"],
  });
  assert.ok(facts.ok, JSON.stringify(facts));
  return { surface: canonical.value, facts: facts.value };
}
function directory(name = "test.surface") {
  assert.equal(typeof compiler.createManagedSurfaceDirectory, "function");
  const { surface, facts } = fixture(),
    created = compiler.createManagedSurfaceDirectory(
      name,
      surface,
      facts,
      "Frame",
    );
  assert.ok(created.ok, JSON.stringify(created));
  return created.value;
}
test("directory binds semantic classes, helper-free witnesses, complete layouts and stable canonical metadata", () => {
  const first = directory(),
    second = directory();
  assert.deepEqual(first.directory, second.directory);
  assert.equal(first.directory.version, 4);
  assert.equal(first.directory.frame, "Frame");
  assert.deepEqual(first.directory.abi.functionBrand, [40, 1, 16, 0]);
  // The image's barrier policy, false unless its facts say otherwise.
  assert.equal(first.directory.abi.generationalBarriers, false);
  const { surface, facts } = fixture(),
    barriered = compiler.createManagedSurfaceDirectory(
      "test.surface",
      surface,
      { ...facts, generationalBarriers: true },
      "Frame",
    );
  assert.ok(barriered.ok, JSON.stringify(barriered));
  assert.equal(barriered.value.directory.abi.generationalBarriers, true);
  assert.notEqual(barriered.value.directory.digest, first.directory.digest);
  assert.equal(first.witnesses.length, 1);
  assert.equal(first.directory.signatures.length, 3);
  assert.equal(
    first.directory.signatures.filter((entry) => entry.function >= 2).length,
    1,
  );
  assert.match(first.directory.digest, /^[0-9a-f]{64}$/);
  const encoded = compiler.encodeManagedSurfaceDirectory(first.directory);
  assert.ok(encoded.ok, JSON.stringify(encoded));
  assert.equal(
    createHash("sha256").update(encoded.value).digest("hex"),
    first.directory.digest,
  );
  const view = new DataView(
    encoded.value.buffer,
    encoded.value.byteOffset,
    encoded.value.byteLength,
  );
  assert.equal(view.getUint32(0, true), 22);
  assert.equal(view.getUint16(4, true), "t".charCodeAt(0));
  assert.equal(view.getUint32(48, true), 4);
});
test("directory digest preserves lone surrogates and binds semantic names, ordering and physical offsets", () => {
  assert.notEqual(
    directory("surface\uD800").directory.digest,
    directory("surface\uD801").directory.digest,
  );
  const original = directory().directory;
  for (const changed of [
    { ...original, name: original.name + "x" },
    {
      ...original,
      abi: {
        ...original.abi,
        generationalBarriers: !original.abi.generationalBarriers,
      },
    },
    {
      ...original,
      types: {
        ...original.types,
        declarations: original.types.declarations.replace("label", "renamed"),
      },
    },
    {
      ...original,
      types: {
        ...original.types,
        entries: [...original.types.entries].reverse(),
      },
    },
    {
      ...original,
      records: original.records.map((entry, index) =>
        index === 0
          ? {
              ...entry,
              layout: {
                ...entry.layout,
                byteLength: entry.layout.byteLength + 16,
              },
            }
          : entry,
      ),
    },
  ]) {
    const digest = compiler.digestManagedSurfaceDirectory(changed);
    assert.ok(digest.ok, JSON.stringify(digest));
    assert.notEqual(digest.value, original.digest);
  }
});
test("directory creation rejects incomplete facts, unknown frames and class physical skew", () => {
  assert.equal(typeof compiler.createManagedSurfaceDirectory, "function");
  const { surface, facts } = fixture();
  for (const changed of [
    { ...facts, records: facts.records.slice(1) },
    { ...facts, signatures: [...facts.signatures, facts.signatures[0]!] },
  ]) {
    const result = compiler.createManagedSurfaceDirectory(
      "surface",
      surface,
      changed,
    );
    assert.equal(result.ok, false);
  }
  const frame = compiler.createManagedSurfaceDirectory(
    "surface",
    surface,
    facts,
    "missing",
  );
  assert.equal(frame.ok, false);
  const malformed = compiler.createManagedSurfaceDirectory("", surface, facts);
  assert.equal(malformed.ok, false);
});
test("directory encoding rejects out-of-range words and unencoded environment state", () => {
  const original = directory().directory;
  for (const changed of [
    { ...original, version: 0x100000000 },
    {
      ...original,
      signatures: original.signatures.map((entry, index) =>
        index === 0 ? { ...entry, function: -1 } : entry,
      ),
    },
    {
      ...original,
      records: original.records.map((entry, index) =>
        index === 0
          ? {
              ...entry,
              layout: {
                ...entry.layout,
                fields: entry.layout.fields.map((field, i) =>
                  i === 0 ? { ...field, stateOffset: 0 } : field,
                ),
              },
            }
          : entry,
      ),
    },
  ])
    assert.equal(compiler.encodeManagedSurfaceDirectory(changed).ok, false);
});

test("directory rejects differing physical facts within one exact recursive class", () => {
  const restored = compiler.restoreManagedSurfaceTypes({
    version: 1,
    declarations:
      "type A={readonly next:A|undefined};type B={readonly next:B|undefined};type F=(value:A)=>A;type G=(value:B)=>B;type Table={readonly f:F;readonly g:G};",
    table: "Table",
    entries: [
      { name: "f", local: "f", type: "F" },
      { name: "g", local: "g", type: "G" },
    ],
    types: [],
  });
  assert.ok(restored.ok);
  const canonical = compiler.canonicalizeManagedSurfaceTypes(restored.value);
  assert.ok(canonical.ok);
  const plan = compiler.planManagedSurfaceContracts(canonical.value);
  assert.ok(plan.ok);
  const facts = compiler.deriveManagedSurfacePhysicalFacts(canonical.value, {
    modules: [],
    runtimes: [],
    globals: ["undefined"],
  });
  assert.ok(facts.ok);
  const group = plan.value.records.find((group) => group.aliases.length > 0);
  assert.ok(group);
  const changed = {
    ...facts.value,
    records: facts.value.records.map((entry) =>
      entry.alias === group.aliases[0]
        ? {
            ...entry,
            layout: {
              ...entry.layout,
              byteLength: entry.layout.byteLength + 16,
            },
          }
        : entry,
    ),
  };
  const rejected = compiler.createManagedSurfaceDirectory(
    "surface",
    canonical.value,
    changed,
  );
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.match(rejected.error, /class physical skew/);
});
test("directory snapshots physical facts before their caller reuses the data", () => {
  const { surface, facts } = fixture();
  const owned = {
    ...facts,
    records: facts.records.map((entry) => ({
      ...entry,
      layout: {
        ...entry.layout,
        fields: entry.layout.fields.map((field) => ({ ...field })),
      },
    })),
  };
  const built = compiler.createManagedSurfaceDirectory(
    "surface",
    surface,
    owned,
  );
  assert.ok(built.ok);
  const original = built.value.directory.digest;
  const field = owned.records[0]?.layout.fields[0];
  assert.ok(field);
  field.offset += 8;
  const digest = compiler.digestManagedSurfaceDirectory(built.value.directory);
  assert.ok(digest.ok);
  assert.equal(digest.value, original);
});

test("AOT agreement validates every semantic alias without requiring unique physical layouts", () => {
  assert.equal(
    typeof compiler.verifyManagedSurfacePhysicalAgreement,
    "function",
  );
  const { surface, facts } = fixture();
  const prepared = compiler.createManagedSurfaceDirectory(
    "agreement",
    surface,
    facts,
    "Frame",
  );
  assert.ok(prepared.ok);
  const original = JSON.stringify(facts);
  assert.deepEqual(
    compiler.verifyManagedSurfacePhysicalAgreement(
      prepared.value.directory,
      facts,
    ),
    { ok: true },
  );
  assert.equal(JSON.stringify(facts), original);
  const changedRecord = facts.records[0]!;
  const changedSignature = facts.signatures[0]!;
  const badFacts: readonly [compiler.ManagedSurfacePhysicalFacts, RegExp][] = [
    [{ ...facts, records: facts.records.slice(1) }, /missing AOT layout/],
    [{ ...facts, signatures: facts.signatures.slice(1) }, /missing AOT ABI/],
    [
      { ...facts, records: [...facts.records, changedRecord] },
      /duplicate AOT layout/,
    ],
    [
      { ...facts, signatures: [...facts.signatures, changedSignature] },
      /duplicate AOT ABI/,
    ],
    [
      {
        ...facts,
        records: [...facts.records, { ...changedRecord, alias: "$foreign" }],
      },
      /unexpected AOT layout/,
    ],
    [
      {
        ...facts,
        signatures: [
          ...facts.signatures,
          { ...changedSignature, alias: "$foreign" },
        ],
      },
      /unexpected AOT ABI/,
    ],
    [
      {
        ...facts,
        records: facts.records.map((record, index) =>
          index === 0
            ? {
                ...record,
                layout: {
                  ...record.layout,
                  byteLength: record.layout.byteLength + 16,
                },
              }
            : record,
        ),
      },
      /AOT layout skew/,
    ],
    [
      {
        ...facts,
        signatures: facts.signatures.map((signature, index) =>
          index === 0
            ? { ...signature, parameters: [...signature.parameters, "number"] }
            : signature,
        ),
      },
      /AOT ABI skew/,
    ],
    [
      {
        ...facts,
        signatures: facts.signatures.map((signature, index) =>
          index === 0
            ? {
                ...signature,
                returnType: signature.returnType === "void" ? "number" : "void",
              }
            : signature,
        ),
      },
      /AOT ABI skew/,
    ],
  ];
  for (const [actual, reason] of badFacts) {
    const result = compiler.verifyManagedSurfacePhysicalAgreement(
      prepared.value.directory,
      actual,
    );
    assert.equal(result.ok, false, JSON.stringify(actual));
    if (!result.ok) assert.match(result.error, reason);
  }
  for (const key of [
    "mutable",
    "offset",
    "presenceOffset",
    "stateOffset",
    "type",
  ] as const) {
    const actual = {
      ...facts,
      records: facts.records.map((record, index) =>
        index === 0
          ? {
              ...record,
              layout: {
                ...record.layout,
                fields: record.layout.fields.map((field, fieldIndex) =>
                  fieldIndex === 0
                    ? {
                        ...field,
                        ...(key === "mutable"
                          ? { mutable: !field.mutable }
                          : key === "type"
                            ? {
                                type:
                                  field.type === "number"
                                    ? ("reference" as const)
                                    : ("number" as const),
                              }
                            : { [key]: (field[key] ?? 0) + 8 }),
                      }
                    : field,
                ),
              },
            }
          : record,
      ),
    };
    const result = compiler.verifyManagedSurfacePhysicalAgreement(
      prepared.value.directory,
      actual,
    );
    assert.equal(result.ok, false, key);
    if (!result.ok) assert.match(result.error, /AOT layout skew/);
  }
  const record = prepared.value.directory.records[0]!;
  const malformed = {
    ...prepared.value.directory,
    records: [...prepared.value.directory.records, record],
  };
  const result = compiler.verifyManagedSurfacePhysicalAgreement(
    malformed,
    facts,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /duplicate directory layout/);
});
