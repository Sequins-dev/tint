import {
  referenceListHeader,
  referenceListCell,
  referenceListPayload,
  listFunctionSignature,
} from "./reference-list-contract.ts";
import type {
  ModuleIR,
  FunctionIR,
  Block,
  Instruction,
} from "../scalar/index.ts";
export interface ReferenceListAccessors {
  readonly functions: readonly FunctionIR[];
  readonly read: number;
  readonly has: number;
  readonly delete: number;
}
export interface ReferenceListFallback {
  readonly read: number;
  readonly has: number;
  readonly delete: number;
}
/** Construct private dense-list accessors, without rewriting any caller. The
 * caller must separately prove header opacity and migrate every mutating operation.
 * Header: length/root. Vector null means a hole; a nonnull cell may contain null
 * for present undefined. Every cell beyond logical length must be absent.
 * Non-vector roots retain the supplied sparse implementation. */
export function buildReferenceListAccessors(
  module: ModuleIR,
  header: number,
  cell: number,
  fallback: ReferenceListFallback,
  directReferences: boolean = false,
): ReferenceListAccessors | undefined {
  const payload = referenceListPayload(module, cell);
  if (payload === undefined) return undefined;
  const element = payload;
  if (directReferences && element !== "optional-reference") return undefined;
  if (
    !referenceListHeader(module, header) ||
    !referenceListCell(module, cell) ||
    !listFunctionSignature(
      module,
      fallback.read,
      ["reference", "number"],
      element,
    ) ||
    !listFunctionSignature(
      module,
      fallback.has,
      ["reference", "number"],
      "boolean",
    ) ||
    !listFunctionSignature(
      module,
      fallback.delete,
      ["reference", "number"],
      "boolean",
    ) ||
    module.functions.length > 0xfffffffc
  )
    return undefined;
  function generate(
    id: number,
    mode: "read" | "has" | "delete",
    target: number,
  ): FunctionIR {
    const fallbackArguments: number[] = [8, 9];
    const reference = mode === "read",
      trap = reference ? 7 : 6;
    const blocks: Block[] = [
      {
        id: 0,
        instructions: [{ kind: "load", id: 0, slot: 0, start: 0, end: 0 }],
        terminator: {
          kind: "record",
          object: 0,
          record: header,
          field: 1,
          operation: "read",
          slot: 2,
          consequent: 1,
          alternate: trap,
          start: 0,
          end: 0,
        },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 1, slot: 2, start: 0, end: 0 },
          { kind: "reference-vector-is", id: 2, vector: 1, start: 0, end: 0 },
        ],
        terminator: {
          kind: "branch",
          condition: 2,
          consequent: 2,
          alternate: 3,
          start: 0,
          end: 0,
        },
      },
      {
        id: 2,
        instructions: [
          { kind: "load", id: 3, slot: 2, start: 0, end: 0 },
          { kind: "reference-value", id: 4, value: 3, start: 0, end: 0 },
          { kind: "store", slot: 3, value: 4, start: 0, end: 0 },
          { kind: "load", id: 5, slot: 1, start: 0, end: 0 },
          {
            kind: "reference-vector-read",
            id: 6,
            vector: 4,
            index: 5,
            start: 0,
            end: 0,
          },
          { kind: "store", slot: 4, value: 6, start: 0, end: 0 },
          {
            kind: "unary",
            id: 7,
            operator: "truthy",
            operand: 6,
            start: 0,
            end: 0,
          },
        ],
        terminator: {
          kind: "branch",
          condition: 7,
          consequent: 4,
          alternate: 5,
          start: 0,
          end: 0,
        },
      },
      {
        id: 3,
        instructions: [
          { kind: "load", id: 8, slot: 0, start: 0, end: 0 },
          { kind: "load", id: 9, slot: 1, start: 0, end: 0 },
          {
            kind: "call",
            id: 10,
            target,
            arguments: fallbackArguments,
            start: 0,
            end: 0,
          },
        ],
        terminator: { kind: "return", value: 10, start: 0, end: 0 },
      },
    ];
    if (reference && directReferences) {
      blocks.push({
        id: 4,
        instructions: [
          { kind: "load", id: 11, slot: 4, start: 0, end: 0 },
          { kind: "load", id: 12, slot: 2, start: 0, end: 0 },
          {
            kind: "binary",
            id: 20,
            operator: "===",
            left: 11,
            right: 12,
            start: 0,
            end: 0,
          },
        ],
        terminator: {
          kind: "branch",
          condition: 20,
          consequent: 5,
          alternate: 6,
          start: 0,
          end: 0,
        },
      });
    } else if (reference) {
      blocks.push({
        id: 4,
        instructions: [
          { kind: "load", id: 11, slot: 4, start: 0, end: 0 },
          { kind: "reference-value", id: 12, value: 11, start: 0, end: 0 },
        ],
        terminator: {
          kind: "record",
          object: 12,
          record: cell,
          field: 0,
          operation: "read",
          slot: 5,
          consequent: 6,
          alternate: trap,
          start: 0,
          end: 0,
        },
      });
    } else {
      const instructions: Instruction[] = [];
      if (mode === "delete")
        instructions.push(
          { kind: "load", id: 11, slot: 3, start: 0, end: 0 },
          { kind: "load", id: 12, slot: 1, start: 0, end: 0 },
          { kind: "reference-none", id: 13, start: 0, end: 0 },
          {
            kind: "reference-vector-write",
            vector: 11,
            index: 12,
            value: 13,
            start: 0,
            end: 0,
          },
        );
      instructions.push({
        kind: "constant",
        id: 14,
        value: true,
        start: 0,
        end: 0,
      });
      blocks.push({
        id: 4,
        instructions,
        terminator: { kind: "return", value: 14, start: 0, end: 0 },
      });
    }
    const missing: Instruction[] = [];
    if (!reference)
      missing.push({
        kind: "constant",
        id: 15,
        value: false,
        start: 0,
        end: 0,
      });
    else if (element === "optional-reference")
      missing.push({ kind: "reference-none", id: 15, start: 0, end: 0 });
    else if (element === "optional-string")
      missing.push({ kind: "string-none", id: 15, start: 0, end: 0 });
    else {
      // The boxed primitive runtime owns its undefined encoding. Invoke its
      // original reader on a private empty header rather than inventing a tag.
      const fields: number[] = [17, 18],
        args: number[] = [19, 17];
      missing.push({ kind: "constant", id: 17, value: 0, start: 0, end: 0 });
      missing.push({ kind: "reference-none", id: 18, start: 0, end: 0 });
      missing.push({
        kind: "record-new",
        id: 19,
        record: header,
        arguments: fields,
        start: 0,
        end: 0,
      });
      missing.push({
        kind: "call",
        id: 15,
        target: fallback.read,
        arguments: args,
        start: 0,
        end: 0,
      });
    }
    blocks.push({
      id: 5,
      instructions: missing,
      terminator: { kind: "return", value: 15, start: 0, end: 0 },
    });
    if (reference)
      blocks.push({
        id: 6,
        instructions: [
          {
            kind: "load",
            id: 16,
            slot: directReferences ? 4 : 5,
            start: 0,
            end: 0,
          },
        ],
        terminator: { kind: "return", value: 16, start: 0, end: 0 },
      });
    blocks.push({
      id: trap,
      instructions: [],
      terminator: { kind: "trap", start: 0, end: 0 },
    });
    return {
      id,
      name: "__tint_reference_list_" + mode + "$" + id,
      exported: false,
      parameters: [0, 1],
      slots: [
        "reference",
        "number",
        "optional-reference",
        "reference",
        "optional-reference",
        reference ? element : "boolean",
      ],
      returnType: reference ? element : "boolean",
      entry: 0,
      blocks,
    };
  }
  const read = module.functions.length,
    has = read + 1,
    remove = read + 2;
  return {
    read,
    has,
    delete: remove,
    functions: [
      generate(read, "read", fallback.read),
      generate(has, "has", fallback.has),
      generate(remove, "delete", fallback.delete),
    ],
  };
}
