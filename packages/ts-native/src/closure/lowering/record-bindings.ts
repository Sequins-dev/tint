import type { FunctionIR, Block, Span } from "@tint/ir/scalar";

export type RecordOperation = "test" | "view" | "descriptor" | "identity";

/** Signature and semantic result types are validated by the source adapter. */
export function bindRecordOperation(
  fn: FunctionIR,
  input: number,
  record: number,
  operation: RecordOperation,
  span: Span,
): FunctionIR {
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
