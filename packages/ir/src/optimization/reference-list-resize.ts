import { createFunctionBuilder } from "../scalar/index.ts";
import {
  referenceListHeader,
  listFunctionSignature,
} from "./reference-list-contract.ts";
import type { ModuleIR, FunctionIR } from "../scalar/index.ts";
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
  call,
  returnVoid,
} from "./function-builder.ts";
/** Private vector list policy. Caller must prove header opacity and keep all
 * mutators on this policy; arbitrary records cannot opt into vector semantics. */
export function buildReferenceListResize(
  module: ModuleIR,
  header: number,
  fallback: number,
): FunctionIR | undefined {
  if (
    !referenceListHeader(module, header) ||
    !listFunctionSignature(module, fallback, ["reference", "number"], "void")
  )
    return undefined;
  const b = createFunctionBuilder(
      module.functions.length,
      "__tint_reference_list_resize$" + module.functions.length,
      ["reference", "number"],
      "void",
    ),
    trap = b.block(),
    invalid = b.block(),
    nonnegative = b.block(),
    bounded = b.block(),
    valid = b.block(),
    dense = b.block(),
    sparse = b.block(),
    clear = b.block(),
    nonzero = b.block(),
    shrink = b.block(),
    publish = b.block(),
    useOld = b.block(),
    useCapacity = b.block(),
    loop = b.block(),
    body = b.block();
  const zero = constant(b, 0),
    one = constant(b, 1),
    maximum = constant(b, 0xffffffff),
    absent = none(b),
    root = b.slot("optional-reference"),
    oldLength = b.slot("number"),
    index = b.slot("number"),
    limit = b.slot("number");
  branch(b, unary(b, "is-integer", 1, "boolean"), nonnegative, invalid);
  b.at(nonnegative);
  branch(b, binary(b, ">=", 1, zero, "boolean"), bounded, invalid);
  b.at(bounded);
  branch(b, binary(b, "<=", 1, maximum, "boolean"), valid, invalid);
  b.at(valid);
  field(b, 0, header, 1, root, false, trap);
  branch(b, vectorProperty(b, root, true), dense, sparse);
  b.at(sparse);
  call(b, fallback, [0, 1]);
  returnVoid(b);
  b.at(dense);
  const vector = reference(b, root, false);
  field(b, 0, header, 0, oldLength, false, trap);
  branch(b, binary(b, "===", 1, zero, "boolean"), clear, nonzero);
  b.at(clear);
  field(b, 0, header, 1, absent, true, trap);
  field(b, 0, header, 0, zero, true, trap);
  returnVoid(b);
  b.at(nonzero);
  branch(b, binary(b, "<", 1, oldLength, "boolean"), shrink, publish);
  b.at(shrink);
  const capacity = vectorProperty(b, vector, false);
  b.save(index, b.load(1));
  branch(
    b,
    binary(b, "<", oldLength, capacity, "boolean"),
    useOld,
    useCapacity,
  );
  b.at(useOld);
  b.save(limit, b.load(oldLength));
  jump(b, loop);
  b.at(useCapacity);
  b.save(limit, b.load(capacity));
  jump(b, loop);
  b.at(loop);
  branch(b, binary(b, "<", index, limit, "boolean"), body, publish);
  b.at(body);
  vectorWrite(b, vector, index, absent);
  const next = binary(b, "+", index, one, "number");
  b.save(index, b.load(next));
  jump(b, loop);
  b.at(publish);
  field(b, 0, header, 0, 1, true, trap);
  returnVoid(b);
  b.at(trap);
  b.end({ kind: "trap", start: 0, end: 0 });
  b.at(invalid);
  b.end({ kind: "throw-literal", value: "INVALID_LENGTH", start: 0, end: 0 });
  return b.finish();
}
