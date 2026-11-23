import {
  createFunctionBuilder,
  type FunctionBuilder,
  type FunctionIR,
  type Span,
} from "@tint/ir/scalar";

/** Throw a new native error with `message` (a string value): a native error
 * record, or the realm's error record (message, presence flag) when the
 * program's errors are realm objects. Ends the current block. */
export function throwNativeError(
  b: FunctionBuilder,
  error: "TypeError" | "ReferenceError",
  message: number,
  realmRecord: number | undefined,
  span: Span,
): void {
  const created = b.next();
  if (realmRecord === undefined)
    b.emit({
      kind: "error-new",
      id: created,
      error,
      message,
      start: span.start,
      end: span.end,
    });
  else {
    const present = b.next();
    b.emit({
      kind: "constant",
      id: present,
      value: true,
      start: span.start,
      end: span.end,
    });
    const fields: (number | undefined)[] = [message, present, undefined];
    b.emit({
      kind: "record-new",
      id: created,
      record: realmRecord,
      arguments: fields,
      start: span.start,
      end: span.end,
    });
  }
  const thrown = b.next();
  b.emit({
    kind: "general-wrap",
    id: thrown,
    value: created,
    start: span.start,
    end: span.end,
  });
  b.end({ kind: "throw", value: thrown, start: span.start, end: span.end });
}

/** The program's out-of-line temporal-dead-zone failure: each access site
 * passes its message, so the allocation and throw exist once. */
export function buildTemporalDeadZoneThrow(
  id: number,
  realmReferenceError: number | undefined,
): FunctionIR {
  const span = { start: 0, end: 0 };
  const b = createFunctionBuilder(
    id,
    "$temporal_dead_zone",
    ["string"],
    "void",
    span,
  );
  throwNativeError(b, "ReferenceError", b.load(0), realmReferenceError, span);
  return b.finish();
}
