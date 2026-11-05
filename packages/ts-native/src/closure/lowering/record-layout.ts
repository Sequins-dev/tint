import {
  scalarByteLength,
  type RecordLayout,
  type ScalarType,
} from "@tint/ir/scalar";
import type { LayoutPlanner } from "@tint/foundation/layout";

export interface RecordFieldStorage {
  readonly type: ScalarType;
  readonly mutable: boolean;
  readonly optional: boolean;
  readonly initialized?: boolean;
}

/** Shared physical layout for plain records, class instances and prototypes. */
export function planRecordLayout(
  fields: readonly RecordFieldStorage[],
  planner: LayoutPlanner,
  fail: (message: string) => never,
): RecordLayout {
  const payload = planner.record(
    fields.map((field, index) => ({
      id: String(index),
      size:
        scalarByteLength(field.type) +
        (field.optional || field.initialized ? 8 : 0),
      alignment: 8,
    })),
  );
  if (!payload.ok) fail("record payload exceeds layout limits");
  const object = planner.object(payload.value);
  if (!object.ok) fail("record allocation exceeds layout limits");
  return {
    byteLength: object.value.byteLength,
    fields: fields.map((field, index) => {
      if (field.optional && field.initialized)
        fail("record presence and initialization require separate fields");
      const placed = payload.value.fields[index];
      if (placed === undefined) throw "record field layout invariant";
      const base = object.value.payloadOffset + placed.offset;
      return {
        type: field.type,
        mutable: field.mutable,
        offset: base + (field.optional || field.initialized ? 8 : 0),
        ...(field.optional ? { presenceOffset: base } : {}),
        ...(field.initialized ? { stateOffset: base } : {}),
      };
    }),
  };
}
