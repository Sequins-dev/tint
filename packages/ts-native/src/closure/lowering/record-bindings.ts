import type {
  ActivationField,
  FunctionDebug,
  FunctionIR,
  Instruction,
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
  /** `(witness: T, value: unknown, site: S): unknown`: the cached own (or
   * inherited) property value of an object value, or a miss (IR
   * property-load). */
  | "property-load"
  | "inherited-property-load"
  /** `(value: unknown, site: S): boolean`: whether a property-load missed
   * (IR general-is "absent"). */
  | "absent-test"
  /** `(witness: T, target: unknown, value: unknown, site: S): boolean`: a
   * cached property store (IR property-store). */
  | "property-store"
  /** `(witness: T): number`: the word index of a named field of T. */
  | "field-word"
  /** `(witness: T, value: unknown, index: number): unknown`: the packed
   * binary64 element of an object value, or a miss (IR element-load). */
  | "element-load"
  /** `(witness: T, target: unknown, index: number, value: unknown):
   * boolean`: overwrite a packed binary64 element (IR element-store). */
  | "element-store"
  /** Native activation chain reads (IR activation-read), without a record
   * witness: `(): number` the innermost record; `(record: number): F` a
   * record's previous record, kind, actual count (numbers) or callee
   * (unknown); `(record: number, index: number): unknown` an actual. */
  | "activation-top"
  | "activation-previous"
  | "activation-kind"
  | "activation-callee"
  | "activation-count"
  | "activation-argument";

/** The record fields a property cache binding reads (see the IR
 * instructions property-load and property-store). */
export interface PropertyCacheLayout {
  readonly record: number;
  readonly field: number;
  readonly count: number;
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
/** A bound body of one instruction over its parameters. */
function boundBody(
  fn: FunctionIR,
  parameters: readonly number[],
  instruction: (loaded: readonly number[]) => Instruction,
  span: Span,
): FunctionIR {
  const instructions: Instruction[] = [];
  const loaded: number[] = [];
  for (const slot of parameters) {
    loaded.push(instructions.length);
    instructions.push({
      start: span.start,
      end: span.end,
      kind: "load",
      id: instructions.length,
      slot,
    });
  }
  const result = instruction(loaded);
  instructions.push(result);
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
        instructions,
        terminator: { ...span, kind: "return", value: loaded.length },
      },
    ],
  };
}
/** The activation field an activation binding reads, or undefined. */
export function activationOperationField(
  operation: RecordOperation,
): ActivationField | undefined {
  switch (operation) {
    case "activation-top":
      return "top";
    case "activation-previous":
      return "previous";
    case "activation-kind":
      return "kind";
    case "activation-callee":
      return "callee";
    case "activation-count":
      return "count";
    case "activation-argument":
      return "argument";
    default:
      return undefined;
  }
}
/** The body of an activation binding: one activation-read of its numeric
 * record (absent for top) and index (argument only) parameters. */
export function bindActivationRead(
  fn: FunctionIR,
  field: ActivationField,
  span: Span,
): FunctionIR {
  return boundBody(
    fn,
    fn.parameters,
    (loaded): Instruction => {
      const id = loaded.length,
        record = loaded[0],
        index = loaded[1];
      if (record === undefined)
        return {
          start: span.start,
          end: span.end,
          kind: "activation-read",
          id,
          field,
        };
      if (index === undefined)
        return {
          start: span.start,
          end: span.end,
          kind: "activation-read",
          id,
          field,
          record,
        };
      return {
        start: span.start,
        end: span.end,
        kind: "activation-read",
        id,
        field,
        record,
        index,
      };
    },
    span,
  );
}
/** The body of a property-load binding: its value and site parameters, the
 * site's entry count, and the epoch record inherited entries name. */
export function bindPropertyLoad(
  fn: FunctionIR,
  value: number,
  site: number,
  layout: PropertyCacheLayout,
  inherited: boolean,
  entries: number,
  epochRecord: number,
  epochField: number,
  span: Span,
): FunctionIR {
  return boundBody(
    fn,
    [value, site],
    (loaded): Instruction => ({
      start: span.start,
      end: span.end,
      kind: "property-load",
      id: loaded.length,
      object: loaded[0] ?? -1,
      site: loaded[1] ?? -1,
      record: layout.record,
      field: layout.field,
      count: layout.count,
      siteRecord: layout.siteRecord,
      siteField: layout.siteField,
      inherited,
      entries,
      epochRecord,
      epochField,
    }),
    span,
  );
}
/** The record fields element-load and element-store read: the witness
 * record's elements field, and the elements record's count and storage. */
export interface ElementLayout {
  readonly record: number;
  readonly field: number;
  readonly elementsRecord: number;
  readonly countField: number;
  readonly storageField: number;
}
/** The body of an element-load binding: its value and index parameters. */
export function bindElementLoad(
  fn: FunctionIR,
  value: number,
  index: number,
  layout: ElementLayout,
  span: Span,
): FunctionIR {
  return boundBody(
    fn,
    [value, index],
    (loaded): Instruction => ({
      start: span.start,
      end: span.end,
      kind: "element-load",
      id: loaded.length,
      object: loaded[0] ?? -1,
      index: loaded[1] ?? -1,
      record: layout.record,
      field: layout.field,
      elementsRecord: layout.elementsRecord,
      countField: layout.countField,
      storageField: layout.storageField,
    }),
    span,
  );
}
/** The body of an element-store binding: its target, index and value
 * parameters. */
export function bindElementStore(
  fn: FunctionIR,
  target: number,
  index: number,
  value: number,
  layout: ElementLayout,
  span: Span,
): FunctionIR {
  return boundBody(
    fn,
    [target, index, value],
    (loaded): Instruction => ({
      start: span.start,
      end: span.end,
      kind: "element-store",
      id: loaded.length,
      object: loaded[0] ?? -1,
      index: loaded[1] ?? -1,
      value: loaded[2] ?? -1,
      record: layout.record,
      field: layout.field,
      elementsRecord: layout.elementsRecord,
      countField: layout.countField,
      storageField: layout.storageField,
    }),
    span,
  );
}
/** The body of an absent-test binding: its value parameter's miss test. */
export function bindAbsentTest(
  fn: FunctionIR,
  value: number,
  span: Span,
): FunctionIR {
  return boundBody(
    fn,
    [value],
    (loaded): Instruction => ({
      start: span.start,
      end: span.end,
      kind: "general-is",
      id: loaded.length,
      value: loaded[0] ?? -1,
      type: "absent",
    }),
    span,
  );
}
/** The body of a property-store binding: its target, value and site
 * parameters, and the epoch record the site's transition entry names. */
export function bindPropertyStore(
  fn: FunctionIR,
  target: number,
  value: number,
  site: number,
  layout: PropertyCacheLayout,
  epochRecord: number,
  epochField: number,
  span: Span,
): FunctionIR {
  return boundBody(
    fn,
    [target, value, site],
    (loaded): Instruction => ({
      start: span.start,
      end: span.end,
      kind: "property-store",
      id: loaded.length,
      object: loaded[0] ?? -1,
      value: loaded[1] ?? -1,
      site: loaded[2] ?? -1,
      record: layout.record,
      field: layout.field,
      count: layout.count,
      siteRecord: layout.siteRecord,
      siteField: layout.siteField,
      epochRecord,
      epochField,
    }),
    span,
  );
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
