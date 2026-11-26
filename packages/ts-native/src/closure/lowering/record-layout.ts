import {
  extendRecordLayout,
  placeRecordFields,
  type RecordFieldShape,
  type RecordLayout,
} from "@tint/ir/scalar";
import type { LayoutPlanner } from "@tint/foundation/layout";

export type RecordFieldStorage = RecordFieldShape;

/** Shared physical layout for plain records, class instances and prototypes
 * (see placeRecordFields); the target planner supplies the header and
 * allocation granule and bounds the extent. */
export function planRecordLayout(
  fields: readonly RecordFieldStorage[],
  planner: LayoutPlanner,
  fail: (message: string) => never,
): RecordLayout {
  for (const field of fields) {
    if (field === undefined) throw "record field shape invariant";
    if (field.optional && field.initialized === true)
      fail("record presence and initialization require separate fields");
  }
  const header = planner.object({ size: 0, alignment: 8 });
  if (!header.ok) fail("record allocation exceeds layout limits");
  const layout = placeRecordFields(
    fields,
    header.value.payloadOffset,
    header.value.alignment,
  );
  const extent = planner.object({
    size: layout.byteLength - header.value.payloadOffset,
    alignment: 8,
  });
  if (!extent.ok || extent.value.byteLength !== layout.byteLength)
    fail("record allocation exceeds layout limits");
  return layout;
}

/** A layout extending `base` unchanged with `fields` (extendRecordLayout),
 * within the allocation limits. */
export function planExtendedRecordLayout(
  base: RecordLayout,
  fields: readonly RecordFieldStorage[],
  planner: LayoutPlanner,
  fail: (message: string) => never,
): RecordLayout {
  const header = planner.object({ size: 0, alignment: 8 });
  if (!header.ok) fail("record allocation exceeds layout limits");
  const layout = extendRecordLayout(base, fields, header.value.alignment);
  const extent = planner.object({
    size: layout.byteLength - header.value.payloadOffset,
    alignment: 8,
  });
  if (!extent.ok || extent.value.byteLength !== layout.byteLength)
    fail("record allocation exceeds layout limits");
  return layout;
}
