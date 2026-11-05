import type { FunctionBuilder, ScalarType } from "../scalar/index.ts";
export function constant(b: FunctionBuilder, value: number | boolean): number {
  const slot = b.slot(typeof value === "number" ? "number" : "boolean"),
    id = b.next();
  b.emit({ kind: "constant", id, value, start: 0, end: 0 });
  b.save(slot, id);
  return slot;
}
export function none(b: FunctionBuilder): number {
  const slot = b.slot("optional-reference"),
    id = b.next();
  b.emit({ kind: "reference-none", id, start: 0, end: 0 });
  b.save(slot, id);
  return slot;
}
export function unary(
  b: FunctionBuilder,
  operator: string,
  operand: number,
  type: ScalarType,
): number {
  const slot = b.slot(type),
    id = b.next();
  b.emit({
    kind: "unary",
    id,
    operator,
    operand: b.load(operand),
    start: 0,
    end: 0,
  });
  b.save(slot, id);
  return slot;
}
export function binary(
  b: FunctionBuilder,
  operator: string,
  left: number,
  right: number,
  type: ScalarType,
): number {
  const slot = b.slot(type),
    id = b.next();
  b.emit({
    kind: "binary",
    id,
    operator,
    left: b.load(left),
    right: b.load(right),
    start: 0,
    end: 0,
  });
  b.save(slot, id);
  return slot;
}
export function branch(
  b: FunctionBuilder,
  condition: number,
  consequent: number,
  alternate: number,
): void {
  b.end({
    kind: "branch",
    condition: b.load(condition),
    consequent,
    alternate,
    start: 0,
    end: 0,
  });
}
export function jump(b: FunctionBuilder, target: number): void {
  b.end({ kind: "jump", target, start: 0, end: 0 });
}
export function field(
  b: FunctionBuilder,
  object: number,
  record: number,
  index: number,
  slot: number,
  write: boolean,
  trap: number,
): void {
  const next = b.block();
  const operation: "read" | "write" = write ? "write" : "read";
  b.end({
    kind: "record",
    object: b.load(object),
    record,
    field: index,
    slot,
    operation,
    consequent: next,
    alternate: trap,
    start: 0,
    end: 0,
  });
  b.at(next);
}
export function reference(
  b: FunctionBuilder,
  source: number,
  wrap: boolean,
): number {
  const slot = b.slot(wrap ? "optional-reference" : "reference"),
    id = b.next();
  b.emit(
    wrap
      ? { kind: "reference-wrap", id, value: b.load(source), start: 0, end: 0 }
      : {
          kind: "reference-value",
          id,
          value: b.load(source),
          start: 0,
          end: 0,
        },
  );
  b.save(slot, id);
  return slot;
}
export function vectorProperty(
  b: FunctionBuilder,
  source: number,
  is: boolean,
): number {
  const slot = b.slot(is ? "boolean" : "number"),
    id = b.next();
  const vector = b.load(source);
  if (is) b.emit({ kind: "reference-vector-is", id, vector, start: 0, end: 0 });
  else
    b.emit({ kind: "reference-vector-length", id, vector, start: 0, end: 0 });
  b.save(slot, id);
  return slot;
}
export function vectorWrite(
  b: FunctionBuilder,
  vector: number,
  index: number,
  value: number,
): void {
  b.emit({
    kind: "reference-vector-write",
    vector: b.load(vector),
    index: b.load(index),
    value: b.load(value),
    start: 0,
    end: 0,
  });
}
export function call(
  b: FunctionBuilder,
  target: number,
  args: readonly number[],
  result?: ScalarType,
): number | undefined {
  const slot = result === undefined ? undefined : b.slot(result),
    id = slot === undefined ? undefined : b.next();
  b.emit({
    kind: "call",
    id,
    target,
    arguments: args.map(b.load),
    start: 0,
    end: 0,
  });
  if (slot !== undefined && id !== undefined) b.save(slot, id);
  return slot;
}
export function returnVoid(b: FunctionBuilder): void {
  b.end({ kind: "return", value: undefined, start: 0, end: 0 });
}
export function vectorRead(
  b: FunctionBuilder,
  vector: number,
  index: number,
): number {
  const slot = b.slot("optional-reference"),
    id = b.next();
  b.emit({
    kind: "reference-vector-read",
    id,
    vector: b.load(vector),
    index: b.load(index),
    start: 0,
    end: 0,
  });
  b.save(slot, id);
  return slot;
}
export function newVector(b: FunctionBuilder, length: number): number {
  const slot = b.slot("reference"),
    id = b.next();
  b.emit({
    kind: "reference-vector-new",
    id,
    length: b.load(length),
    start: 0,
    end: 0,
  });
  b.save(slot, id);
  return slot;
}
export function newRecord(
  b: FunctionBuilder,
  record: number,
  args: readonly number[],
): number {
  const slot = b.slot("reference"),
    id = b.next();
  b.emit({
    kind: "record-new",
    id,
    record,
    arguments: args.map(b.load),
    start: 0,
    end: 0,
  });
  b.save(slot, id);
  return slot;
}
