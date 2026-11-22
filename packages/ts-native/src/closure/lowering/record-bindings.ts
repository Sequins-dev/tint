import type {
  FunctionDebug,
  FunctionIR,
  SlotBinding,
  Block,
  ScalarType,
  Span,
  Terminator,
} from "@tint/ir/scalar";

export type RecordOperation =
  | "test"
  | "view"
  | "descriptor"
  | "identity"
  /** `(record: T): unknown`: the JavaScript view held in a viewed record's
   * hidden slot (undefined before the first crossing, or for a record of
   * another layout). */
  | "view-slot"
  /** `(record: T, index: number): F`: field `field + index` of the record's
   * `count` consecutive fields of type F (index checked). */
  | "slot-read"
  /** `(record: T, view: unknown): void`: store the view (ignored for a
   * record of another layout). */
  | "set-view-slot"
  /** `(witness: T, value: unknown, site: S): C | undefined`: the cached own
   * (or inherited) property cell of an object value (IR property-cell). */
  | "property-cell"
  | "inherited-property-cell"
  /** `(witness: T): number`: the word index of a named field of T. */
  | "field-word";

/** The record fields a property-cell binding reads (see the IR
 * instruction). */
export interface PropertyCellLayout {
  readonly record: number;
  readonly field: number;
  readonly count: number;
  readonly cellRecord: number;
  readonly prototypeField: number;
  readonly siteRecord: number;
  readonly siteField: number;
}
/** A bound body's slots: its parameters only, so the replaced source
 * body's locals cannot keep it from inlining. */
function parameterSlots(fn: FunctionIR): ScalarType[] {
  const slots: ScalarType[] = [];
  for (let index = 0; index < fn.parameters.length; index++) {
    const type = fn.slots[index];
    if (fn.parameters[index] !== index || type === undefined)
      throw "record binding parameter invariant";
    slots.push(type);
  }
  return slots;
}
/** Debug metadata of a bound body: source variables and parameter slots
 * remain; bindings of the replaced body's values and locals do not. */
function parameterDebug(
  debug: FunctionDebug,
  parameters: number,
): FunctionDebug {
  const slots: SlotBinding[] = [];
  for (const binding of debug.slots) {
    if (binding === undefined) throw "record binding debug invariant";
    if (binding.slot < parameters) slots.push(binding);
  }
  return {
    variables: debug.variables,
    slots,
    values: [],
    inlineSites: debug.inlineSites,
  };
}
/** The body of a property-cell binding: its value and site parameters. */
export function bindPropertyCell(
  fn: FunctionIR,
  value: number,
  site: number,
  layout: PropertyCellLayout,
  inherited: boolean,
  span: Span,
): FunctionIR {
  return {
    ...fn,
    slots: parameterSlots(fn),
    ...(fn.debug === undefined
      ? {}
      : { debug: parameterDebug(fn.debug, fn.parameters.length) }),
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { ...span, kind: "load", id: 0, slot: value },
          { ...span, kind: "load", id: 1, slot: site },
          {
            ...span,
            kind: "property-cell",
            id: 2,
            object: 0,
            site: 1,
            record: layout.record,
            field: layout.field,
            count: layout.count,
            cellRecord: layout.cellRecord,
            prototypeField: layout.prototypeField,
            siteRecord: layout.siteRecord,
            siteField: layout.siteField,
            inherited,
          },
        ],
        terminator: { ...span, kind: "return", value: 2 },
      },
    ],
  };
}
/** The body of a field-word binding: one constant. */
export function bindFieldWord(
  fn: FunctionIR,
  word: number,
  span: Span,
): FunctionIR {
  return {
    ...fn,
    slots: parameterSlots(fn),
    ...(fn.debug === undefined
      ? {}
      : { debug: parameterDebug(fn.debug, fn.parameters.length) }),
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ ...span, kind: "constant", id: 0, value: word }],
        terminator: { ...span, kind: "return", value: 0 },
      },
    ],
  };
}

/** Signature and semantic result types are validated by the source adapter. */
export function bindRecordOperation(
  fn: FunctionIR,
  input: number,
  record: number,
  operation: RecordOperation,
  span: Span,
  /** The view slot's field index (view-slot and set-view-slot), or the
   * first slot field (slot-read). */
  field: number = -1,
  /** slot-read: the number of consecutive slot fields and the index
   * parameter's slot. */
  count: number = 0,
  index: number = -1,
): FunctionIR {
  if (operation === "slot-read") {
    if (field < 0 || count < 1 || index < 0) throw "record slot invariant";
    return {
      ...fn,
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { ...span, kind: "load", id: 0, slot: input },
            { ...span, kind: "load", id: 1, slot: index },
            {
              ...span,
              kind: "record-slot-read",
              id: 2,
              object: 0,
              record,
              field,
              count,
              index: 1,
            },
          ],
          terminator: { ...span, kind: "return", value: 2 },
        },
      ],
    };
  }
  if (operation === "view-slot" || operation === "set-view-slot") {
    if (field < 0) throw "record view slot invariant";
    const read = operation === "view-slot";
    // view-slot reads into an added general slot; set-view-slot writes its
    // second parameter. A record of another layout takes the alternate.
    const slot = read ? fn.slots.length : 1;
    const slots: ScalarType[] = [];
    for (const type of fn.slots) {
      if (type === undefined) throw "record view slot type invariant";
      slots.push(type);
    }
    if (read) slots.push("general");
    const direction: "read" | "write" = read ? "read" : "write";
    const access: Terminator = {
      ...span,
      kind: "record",
      object: 0,
      record,
      field,
      operation: direction,
      slot,
      consequent: 1,
      alternate: 2,
    };
    const blocks: Block[] = [
      {
        id: 0,
        instructions: [{ ...span, kind: "load", id: 0, slot: input }],
        terminator: access,
      },
    ];
    if (read) {
      blocks.push({
        id: 1,
        instructions: [{ ...span, kind: "load", id: 1, slot }],
        terminator: { ...span, kind: "return", value: 1 },
      });
      blocks.push({
        id: 2,
        instructions: [{ ...span, kind: "general-none", id: 2 }],
        terminator: { ...span, kind: "return", value: 2 },
      });
    } else
      for (let id = 1; id <= 2; id++)
        blocks.push({
          id,
          instructions: [],
          terminator: { ...span, kind: "return", value: undefined },
        });
    return { ...fn, slots, entry: 0, blocks };
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
