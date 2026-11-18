import type { FunctionIR, Block, Span } from "@tint/ir/scalar";

export type RecordOperation =
  | "test"
  | "view"
  | "descriptor"
  | "identity"
  /** `(record: T): unknown`: the JavaScript view held in a viewed record's
   * hidden slot (undefined before the first crossing, or for a record of
   * another layout). */
  | "view-slot"
  /** `(record: T, view: unknown): void`: store the view (ignored for a
   * record of another layout). */
  | "set-view-slot";

/** Signature and semantic result types are validated by the source adapter. */
export function bindRecordOperation(
  fn: FunctionIR,
  input: number,
  record: number,
  operation: RecordOperation,
  span: Span,
  /** The view slot's field index (view-slot and set-view-slot). */
  field: number = -1,
): FunctionIR {
  if (operation === "view-slot" || operation === "set-view-slot") {
    if (field < 0) throw "record view slot invariant";
    const read = operation === "view-slot";
    // view-slot reads into an added general slot; set-view-slot writes its
    // second parameter. A record of another layout takes the alternate.
    const slot = read ? fn.slots.length : 1;
    return {
      ...fn,
      slots: read ? [...fn.slots, "general"] : fn.slots,
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [{ ...span, kind: "load", id: 0, slot: input }],
          terminator: {
            ...span,
            kind: "record",
            object: 0,
            record,
            field,
            operation: read ? "read" : "write",
            slot,
            consequent: 1,
            alternate: 2,
          },
        },
        read
          ? {
              id: 1,
              instructions: [{ ...span, kind: "load", id: 1, slot }],
              terminator: { ...span, kind: "return", value: 1 },
            }
          : {
              id: 1,
              instructions: [],
              terminator: { ...span, kind: "return", value: undefined },
            },
        read
          ? {
              id: 2,
              instructions: [{ ...span, kind: "general-none", id: 2 }],
              terminator: { ...span, kind: "return", value: 2 },
            }
          : {
              id: 2,
              instructions: [],
              terminator: { ...span, kind: "return", value: undefined },
            },
      ],
    };
  }
  if (operation === "identity")
    return {
      ...fn,
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { ...span, kind: "record-descriptor-address", id: 0, record },
          ],
          terminator: { ...span, kind: "return", value: 0 },
        },
      ],
    };
  if (operation === "descriptor")
    return {
      ...fn,
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { ...span, kind: "load", id: 0, slot: input },
            {
              ...span,
              kind: "general-record-descriptor",
              id: 1,
              value: 0,
              record,
            },
          ],
          terminator: { ...span, kind: "return", value: 1 },
        },
      ],
    };
  const blocks: Block[] = [
    {
      id: 0,
      instructions: [
        { ...span, kind: "load", id: 0, slot: input },
        { ...span, kind: "general-record-is", id: 1, value: 0, record },
      ],
      terminator:
        operation === "test"
          ? { ...span, kind: "return", value: 1 }
          : {
              ...span,
              kind: "branch",
              condition: 1,
              consequent: 1,
              alternate: 2,
            },
    },
  ];
  if (operation === "view") {
    blocks.push({
      id: 1,
      instructions: [
        { ...span, kind: "load", id: 2, slot: input },
        { ...span, kind: "general-value", id: 3, value: 2, type: "reference" },
        { ...span, kind: "reference-wrap", id: 4, value: 3 },
      ],
      terminator: { ...span, kind: "return", value: 4 },
    });
    blocks.push({
      id: 2,
      instructions: [{ ...span, kind: "reference-none", id: 5 }],
      terminator: { ...span, kind: "return", value: 5 },
    });
  }
  return { ...fn, entry: 0, blocks };
}
