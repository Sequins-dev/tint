import {
  createFunctionBuilder,
  type FunctionBuilder,
  type FunctionIR,
  type ModuleIR,
  type RecordLayout,
} from "@tint/ir/scalar";
import {
  buildClassConstruction,
  buildClassStaticInitialization,
} from "@tint/ts-native/closure/lowering";
export type ClassConstructionCase = "normal" | "throw-field" | "throw-body";
const s = { start: 0, end: 0 };
const records: RecordLayout[] = [
  { byteLength: 16, fields: [] },
  {
    byteLength: 64,
    fields: [
      { offset: 24, stateOffset: 16, type: "number", mutable: true },
      { offset: 40, stateOffset: 32, type: "number", mutable: true },
      { offset: 48, type: "reference", mutable: false },
    ],
  },
  {
    byteLength: 48,
    fields: [16, 24, 32, 40].map((offset) => ({
      offset,
      type: "reference",
      mutable: false,
    })),
  },
];
function read(
  b: FunctionBuilder,
  object: number,
  field: number,
  destination: number,
  trap: number,
  write = false,
): void {
  const next = b.block();
  b.end({
    kind: "record-cell",
    object: b.load(object),
    record: 1,
    field,
    slot: destination,
    operation: write ? "write" : "read",
    consequent: next,
    alternate: trap,
    ...s,
  });
  b.at(next);
}
function receiver(
  b: FunctionBuilder,
  slot: number,
  staticMode = false,
): number {
  const object = b.slot("reference"),
    id = b.next();
  b.emit({
    kind: "general-value",
    id,
    value: b.load(slot),
    type: "reference",
    ...s,
  });
  if (staticMode) {
    const state = b.next(),
      unwrapped = b.next();
    b.emit({ kind: "function-environment", id: state, callee: id, ...s });
    b.emit({ kind: "reference-value", id: unwrapped, value: state, ...s });
    b.save(object, unwrapped);
  } else b.save(object, id);
  return object;
}
function constant(b: FunctionBuilder, value: number): number {
  const id = b.next();
  b.emit({ kind: "constant", id, value, ...s });
  return id;
}
function initializer(
  id: number,
  second: boolean,
  mode: ClassConstructionCase,
  staticMode = false,
): FunctionIR {
  const b = createFunctionBuilder(
    id,
    second ? "secondField" : "firstField",
    [],
    "number",
  );
  const thisSlot = b.slot("general");
  if (second && mode === "throw-field") {
    b.end({ kind: "throw-literal", value: "field", ...s });
    return { ...b.finish(), receiverSlot: thisSlot };
  }
  if (!second) {
    b.end({ kind: "return", value: constant(b, 20), ...s });
    return { ...b.finish(), receiverSlot: thisSlot };
  }
  const trap = b.block(),
    object = receiver(b, thisSlot, staticMode),
    value = b.slot("number");
  if (staticMode) {
    const kind = b.next(),
      expected = b.next(),
      equal = b.next(),
      ready = b.block();
    b.emit({ kind: "general-kind", id: kind, value: b.load(thisSlot), ...s });
    b.emit({ kind: "string-literal", id: expected, value: "function", ...s });
    b.emit({
      kind: "binary",
      id: equal,
      operator: "===",
      left: kind,
      right: expected,
      ...s,
    });
    b.end({
      kind: "branch",
      condition: equal,
      consequent: ready,
      alternate: trap,
      ...s,
    });
    b.at(ready);
  }
  read(b, object, 0, value, trap);
  const result = b.next();
  b.emit({
    kind: "binary",
    id: result,
    operator: "+",
    left: b.load(value),
    right: constant(b, staticMode ? 22 : 1),
    ...s,
  });
  b.end({ kind: "return", value: result, ...s });
  b.at(trap);
  b.end({ kind: "trap", ...s });
  return { ...b.finish(), receiverSlot: thisSlot };
}
function body(mode: ClassConstructionCase): FunctionIR {
  const b = createFunctionBuilder(
    4,
    "constructorBody",
    ["optional-number"],
    "void",
  );
  if (mode === "throw-body") {
    b.end({ kind: "throw-literal", value: "body", ...s });
    return b.finish();
  }
  const thisSlot = b.slot("general"),
    object = receiver(b, thisSlot),
    argument = b.slot("number"),
    current = b.slot("number");
  const trap = b.block(),
    present = b.block(),
    absent = b.block(),
    merge = b.block();
  const test = b.next();
  b.emit({ kind: "optional-present", id: test, value: b.load(0), ...s });
  b.end({
    kind: "branch",
    condition: test,
    consequent: present,
    alternate: absent,
    ...s,
  });
  b.at(present);
  const value = b.next();
  b.emit({ kind: "optional-value", id: value, value: b.load(0), ...s });
  b.save(argument, value);
  b.end({ kind: "jump", target: merge, ...s });
  b.at(absent);
  read(b, object, 1, argument, trap);
  b.end({ kind: "jump", target: merge, ...s });
  b.at(merge);
  read(b, object, 1, current, trap);
  const sum = b.next();
  b.emit({
    kind: "binary",
    id: sum,
    operator: "+",
    left: b.load(argument),
    right: b.load(current),
    ...s,
  });
  b.save(current, sum);
  read(b, object, 1, current, trap, true);
  b.end({ kind: "return", value: undefined, ...s });
  b.at(trap);
  b.end({ kind: "trap", ...s });
  return { ...b.finish(), receiverSlot: thisSlot };
}

/** Field two observes field one; constructor parameter default observes field two. */
export function classConstructionBodyFixture(
  mode: ClassConstructionCase = "normal",
  staticMode = false,
): {
  module: ModuleIR;
  bytes: number;
} {
  if (staticMode && mode === "throw-body")
    throw "static initialization has no constructor body";
  const construction = buildClassConstruction(
    {
      id: 1,
      name: "constructBox",
      parameters: ["optional-number"],
      environment: 2,
      prototypeField: 0,
      instance: 1,
      instancePrototypeField: 2,
      fields: [
        { kind: "call", field: 0, entry: { field: 1, target: 2 }, ...s },
        { kind: "call", field: 1, entry: { field: 2, target: 3 }, ...s },
      ],
      body: { field: 3, target: 4 },
      ...s,
    },
    records,
    [
      { parameters: ["number"], returnType: "number" },
      { parameters: ["optional-number"], returnType: "reference" },
      { parameters: [], returnType: "number" },
      { parameters: [], returnType: "number" },
      { parameters: ["optional-number"], returnType: "void" },
    ],
  );
  const staticInitialization = staticMode
    ? buildClassStaticInitialization(
        {
          id: 1,
          name: "initializeBox",
          environment: 2,
          constructorField: 0,
          state: 1,
          fields: [
            { kind: "call", field: 0, entry: { field: 1, target: 2 }, ...s },
            { kind: "call", field: 1, entry: { field: 2, target: 3 }, ...s },
          ],
          ...s,
        },
        records,
        [
          { parameters: ["number"], returnType: "number" },
          { parameters: [], returnType: "void" },
          { parameters: [], returnType: "number" },
          { parameters: [], returnType: "number" },
        ],
      )
    : undefined;
  const b = createFunctionBuilder(0, "run", ["number"], "number");
  const proto = b.next();
  b.emit({ kind: "record-new", id: proto, record: 0, arguments: [], ...s });
  let constructor = proto;
  const stateSlot = b.slot("reference");
  if (staticMode) {
    const state = b.next();
    b.emit({
      kind: "record-new",
      id: state,
      record: 1,
      arguments: [undefined, undefined, proto],
      ...s,
    });
    b.save(stateSlot, state);
    constructor = b.next();
    b.emit({
      kind: "function-new",
      id: constructor,
      target: 5,
      environment: state,
      ...s,
    });
  }
  const entries = [2, 3, 4].map((target) => {
    const id = b.next();
    b.emit({ kind: "function-new", id, target, ...s });
    return id;
  });
  const env = b.next();
  b.emit({
    kind: "record-new",
    id: env,
    record: 2,
    arguments: [constructor, ...entries],
    ...s,
  });
  const ctor = b.next();
  b.emit({ kind: "function-new", id: ctor, target: 1, environment: env, ...s });
  const missing = b.next();
  b.emit({ kind: "undefined", id: missing, ...s });
  const instance = b.next();
  b.emit({
    kind: "call-indirect",
    id: staticMode ? undefined : instance,
    target: 1,
    callee: ctor,
    arguments: staticMode ? [] : [missing],
    ...s,
  });
  const object = b.slot("reference"),
    value = b.slot("number"),
    trap = b.block();
  b.save(object, staticMode ? b.load(stateSlot) : instance);
  read(b, object, 1, value, trap);
  b.end(
    mode === "normal"
      ? { kind: "return", value: b.load(value), ...s }
      : { kind: "trap", ...s },
  );
  b.at(trap);
  b.end({ kind: "trap", ...s });
  const handler = mode === "normal" ? undefined : b.block();
  const caught = b.slot("general");
  if (handler !== undefined) {
    b.at(handler);
    const actual = b.next();
    b.emit({
      kind: "general-value",
      id: actual,
      value: b.load(caught),
      type: "string",
      ...s,
    });
    const expected = b.next();
    b.emit({
      kind: "string-literal",
      id: expected,
      value: mode === "throw-field" ? "field" : "body",
      ...s,
    });
    const equal = b.next();
    b.emit({
      kind: "binary",
      id: equal,
      operator: "===",
      left: actual,
      right: expected,
      ...s,
    });
    const success = b.block();
    b.end({
      kind: "branch",
      condition: equal,
      consequent: success,
      alternate: trap,
      ...s,
    });
    b.at(success);
    b.end({ kind: "return", value: constant(b, 42), ...s });
  }
  const run = b.finish();
  const blocks =
    handler === undefined
      ? run.blocks
      : run.blocks.map((block) =>
          block.instructions.some(
            (op) => op.kind === "call-indirect" && op.target === 1,
          )
            ? { ...block, exception: { target: handler, slot: caught } }
            : block,
        );
  return {
    bytes: staticMode ? 368 : 320,
    module: {
      records,
      functions: [
        { ...run, blocks, exported: true },
        staticInitialization ?? construction,
        initializer(2, false, mode, staticMode),
        initializer(3, true, mode, staticMode),
        body(mode),
        ...(staticMode
          ? [
              {
                id: 5,
                name: "classCall",
                parameters: [],
                slots: [],
                returnType: "void",
                closureEnvironment: 1,
                entry: 0,
                exported: false,
                blocks: [
                  {
                    id: 0,
                    instructions: [],
                    terminator: { kind: "trap", ...s },
                  },
                ],
              } satisfies FunctionIR,
            ]
          : []),
      ],
    },
  };
}
