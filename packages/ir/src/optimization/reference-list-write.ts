import { createFunctionBuilder } from "../scalar/index.ts";
import type { ModuleIR, FunctionIR } from "../scalar/index.ts";
import {
  referenceListHeader,
  referenceListCell,
  referenceListPayload,
  listFunctionSignature,
} from "./reference-list-contract.ts";
import {
  constant,
  none,
  unary,
  binary,
  branch,
  jump,
  field,
  reference,
  vectorProperty,
  vectorWrite,
  vectorRead,
  newVector,
  newRecord,
  call,
  returnVoid,
} from "./function-builder.ts";
/** Private dense/sparse writer. No callers are rewritten here: opacity and complete
 * mutator coverage are separate mandatory authorization proofs. */
export function buildReferenceListWrite(
  module: ModuleIR,
  header: number,
  cell: number,
  create: number,
  write: number,
  directReferences: boolean = false,
): FunctionIR | undefined {
  const element = referenceListPayload(module, cell);
  if (element === undefined) return undefined;
  if (directReferences && element !== "optional-reference") return undefined;
  if (
    !referenceListHeader(module, header) ||
    !referenceListCell(module, cell) ||
    !listFunctionSignature(module, create, ["number"], "reference") ||
    !listFunctionSignature(
      module,
      write,
      ["reference", "number", element],
      "void",
    )
  )
    return undefined;
  const b = createFunctionBuilder(
      module.functions.length,
      "__tint_reference_list_write$" + module.functions.length,
      ["reference", "number", element],
      "void",
    ),
    trap = b.block(),
    invalid = b.block(),
    nonnegative = b.block(),
    bounded = b.block(),
    valid = b.block(),
    dense = b.block(),
    notDense = b.block(),
    empty = b.block(),
    fallback = b.block(),
    emptySmall = b.block(),
    capacityLoop = b.block(),
    capacityGrow = b.block(),
    allocate = b.block(),
    copyLoop = b.block(),
    copyBody = b.block(),
    publish = b.block(),
    store = b.block(),
    existing = b.block(),
    fresh = b.block(),
    length = b.block(),
    extend = b.block(),
    done = b.block(),
    overflow = b.block(),
    sparseTest = b.block(),
    densityTest = b.block(),
    grow = b.block(),
    migrate = b.block(),
    migrationLoop = b.block(),
    migrationBody = b.block(),
    migrationPresent = b.block(),
    migrationNext = b.block(),
    migrationPublish = b.block();
  const zero = constant(b, 0),
    one = constant(b, 1),
    two = constant(b, 2),
    four = constant(b, 4),
    eight = constant(b, 8),
    small = constant(b, 1024),
    denseLimit = constant(b, 1048576),
    maximum = constant(b, 0xffffffff),
    absent = none(b);
  const root = b.slot("optional-reference"),
    vector = b.slot("reference"),
    capacity = b.slot("number"),
    newCapacity = b.slot("number"),
    copyIndex = b.slot("number"),
    oldLength = b.slot("number"),
    entry = b.slot("optional-reference"),
    temporary = b.slot("reference"),
    payload = b.slot(element);
  branch(b, unary(b, "is-integer", 1, "boolean"), nonnegative, invalid);
  b.at(nonnegative);
  branch(b, binary(b, ">=", 1, zero, "boolean"), bounded, invalid);
  b.at(bounded);
  branch(b, binary(b, "<", 1, maximum, "boolean"), valid, invalid);
  b.at(valid);
  field(b, 0, header, 1, root, false, trap);
  branch(b, vectorProperty(b, root, true), dense, notDense);
  b.at(notDense);
  branch(b, unary(b, "truthy", root, "boolean"), fallback, empty);
  b.at(empty);
  branch(b, binary(b, "<=", 1, small, "boolean"), emptySmall, fallback);
  b.at(emptySmall);
  b.save(capacity, b.load(zero));
  b.save(newCapacity, b.load(four));
  jump(b, capacityLoop);
  b.at(dense);
  b.save(vector, b.load(reference(b, root, false)));
  b.save(capacity, b.load(vectorProperty(b, vector, false)));
  branch(b, binary(b, "<", 1, capacity, "boolean"), store, overflow);
  b.at(overflow);
  branch(b, binary(b, "<", 1, denseLimit, "boolean"), sparseTest, migrate);
  b.at(sparseTest);
  branch(b, binary(b, "<=", 1, small, "boolean"), grow, densityTest);
  b.at(densityTest);
  const proportional = binary(b, "*", capacity, eight, "number");
  branch(b, binary(b, "<", 1, proportional, "boolean"), grow, migrate);
  b.at(grow);
  b.save(newCapacity, b.load(binary(b, "*", capacity, two, "number")));
  jump(b, capacityLoop);
  b.at(capacityLoop);
  branch(b, binary(b, "<", 1, newCapacity, "boolean"), allocate, capacityGrow);
  b.at(capacityGrow);
  b.save(newCapacity, b.load(binary(b, "*", newCapacity, two, "number")));
  jump(b, capacityLoop);
  b.at(allocate);
  const replacement = newVector(b, newCapacity);
  b.save(copyIndex, b.load(zero));
  jump(b, copyLoop);
  b.at(copyLoop);
  branch(b, binary(b, "<", copyIndex, capacity, "boolean"), copyBody, publish);
  b.at(copyBody);
  const copied = vectorRead(b, reference(b, root, false), copyIndex);
  if (directReferences) {
    const sentinel = b.block(),
      storeCopy = b.block();
    branch(b, binary(b, "===", copied, root, "boolean"), sentinel, storeCopy);
    b.at(sentinel);
    b.save(copied, b.load(reference(b, replacement, true)));
    jump(b, storeCopy);
    b.at(storeCopy);
  }
  vectorWrite(b, replacement, copyIndex, copied);
  b.save(copyIndex, b.load(binary(b, "+", copyIndex, one, "number")));
  jump(b, copyLoop);
  b.at(publish);
  b.save(vector, b.load(replacement));
  b.save(root, b.load(reference(b, vector, true)));
  field(b, 0, header, 1, root, true, trap);
  jump(b, store);
  b.at(store);
  if (directReferences) {
    branch(b, unary(b, "truthy", 2, "boolean"), existing, fresh);
    b.at(existing);
    vectorWrite(b, vector, 1, 2);
    jump(b, length);
    b.at(fresh);
    vectorWrite(b, vector, 1, reference(b, vector, true));
    jump(b, length);
  } else {
    b.save(entry, b.load(vectorRead(b, vector, 1)));
    branch(b, unary(b, "truthy", entry, "boolean"), existing, fresh);
    b.at(existing);
    const present = reference(b, entry, false);
    field(b, present, cell, 0, 2, true, trap);
    jump(b, length);
    b.at(fresh);
    const made = newRecord(b, cell, [2]),
      wrapped = reference(b, made, true);
    vectorWrite(b, vector, 1, wrapped);
    jump(b, length);
  }
  b.at(length);
  field(b, 0, header, 0, oldLength, false, trap);
  branch(b, binary(b, ">=", 1, oldLength, "boolean"), extend, done);
  b.at(extend);
  const nextLength = binary(b, "+", 1, one, "number");
  field(b, 0, header, 0, nextLength, true, trap);
  jump(b, done);
  b.at(done);
  returnVoid(b);
  b.at(migrate);
  const created = call(b, create, [zero], "reference");
  if (created === undefined) throw "generated create result invariant";
  b.save(temporary, b.load(created));
  b.save(copyIndex, b.load(zero));
  jump(b, migrationLoop);
  b.at(migrationLoop);
  branch(
    b,
    binary(b, "<", copyIndex, capacity, "boolean"),
    migrationBody,
    migrationPublish,
  );
  b.at(migrationBody);
  b.save(entry, b.load(vectorRead(b, vector, copyIndex)));
  branch(
    b,
    unary(b, "truthy", entry, "boolean"),
    migrationPresent,
    migrationNext,
  );
  b.at(migrationPresent);
  if (directReferences) {
    const sentinel = b.block(),
      ready = b.block();
    b.save(payload, b.load(entry));
    branch(b, binary(b, "===", entry, root, "boolean"), sentinel, ready);
    b.at(sentinel);
    b.save(payload, b.load(absent));
    jump(b, ready);
    b.at(ready);
  } else {
    const migrated = reference(b, entry, false);
    field(b, migrated, cell, 0, payload, false, trap);
  }
  call(b, write, [temporary, copyIndex, payload]);
  jump(b, migrationNext);
  b.at(migrationNext);
  b.save(copyIndex, b.load(binary(b, "+", copyIndex, one, "number")));
  jump(b, migrationLoop);
  b.at(migrationPublish);
  field(b, temporary, header, 1, root, false, trap);
  field(b, 0, header, 1, root, true, trap);
  jump(b, fallback);
  b.at(fallback);
  call(b, write, [0, 1, 2]);
  returnVoid(b);
  b.at(trap);
  b.end({ kind: "trap", start: 0, end: 0 });
  b.at(invalid);
  b.end({ kind: "throw-literal", value: "INVALID_INDEX", start: 0, end: 0 });
  return b.finish();
}
