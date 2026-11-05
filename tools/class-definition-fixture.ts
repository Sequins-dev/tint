import {
  createFunctionBuilder,
  type FunctionBuilder,
  type FunctionIR,
  type ModuleIR,
  type RecordLayout,
} from "@tint/ir/scalar";
import {
  buildClassDefinition,
  buildClassConstruction,
  buildClassStaticInitialization,
} from "@tint/ts-native/closure/lowering";
const s = { start: 0, end: 0 };
const records: RecordLayout[] = [
  {
    byteLength: 48,
    fields: [
      { offset: 24, stateOffset: 16, type: "reference", mutable: true },
      { offset: 32, type: "reference", mutable: true },
    ],
  },
  {
    byteLength: 64,
    fields: [
      { offset: 16, type: "reference", mutable: false },
      { offset: 32, stateOffset: 24, type: "reference", mutable: false },
      { offset: 48, stateOffset: 40, type: "number", mutable: true },
    ],
  },
  {
    byteLength: 32,
    fields: [16, 24].map((offset) => ({
      offset,
      type: "reference",
      mutable: false,
    })),
  },
  {
    byteLength: 64,
    fields: [16, 24, 32, 40, 48].map((offset) => ({
      offset,
      type: "reference",
      mutable: false,
    })),
  },
  {
    byteLength: 32,
    fields: [
      { offset: 24, stateOffset: 16, type: "reference", mutable: false },
    ],
  },
  {
    byteLength: 32,
    fields: [16, 24].map((offset) => ({
      offset,
      type: "reference",
      mutable: false,
    })),
  },
  {
    byteLength: 48,
    fields: [
      { offset: 16, type: "reference", mutable: false },
      { offset: 32, stateOffset: 24, type: "number", mutable: true },
    ],
  },
  {
    byteLength: 32,
    fields: [16, 24].map((offset) => ({
      offset,
      type: "reference",
      mutable: false,
    })),
  },
];
function number(b: FunctionBuilder, value: number): number {
  const id = b.next();
  b.emit({ kind: "constant", id, value, ...s });
  return id;
}
function read(
  b: FunctionBuilder,
  object: number,
  record: number,
  field: number,
  trap: number,
): number {
  const storage = records[record]?.fields[field];
  if (storage === undefined) throw "fixture field";
  const slot = b.slot(storage.type),
    next = b.block();
  const operation: "read" = "read";
  const access = {
    object: b.load(object),
    record,
    field,
    operation,
    slot,
    consequent: next,
    alternate: trap,
    ...s,
  };
  b.end(
    storage.stateOffset === undefined
      ? { kind: "record", ...access }
      : { kind: "record-cell", ...access },
  );
  b.at(next);
  return slot;
}
function equal(
  b: FunctionBuilder,
  left: number,
  right: number,
  trap: number,
): void {
  const id = b.next(),
    next = b.block();
  b.emit({ kind: "binary", id, operator: "===", left, right, ...s });
  b.end({
    kind: "branch",
    condition: id,
    consequent: next,
    alternate: trap,
    ...s,
  });
  b.at(next);
}
function allocate(
  b: FunctionBuilder,
  record: number,
  slots: readonly (number | undefined)[],
): number {
  const id = b.next(),
    slot = b.slot("reference");
  b.emit({
    kind: "record-new",
    id,
    record,
    arguments: slots.map((slot) =>
      slot === undefined ? undefined : b.load(slot),
    ),
    ...s,
  });
  b.save(slot, id);
  return slot;
}
function closure(
  b: FunctionBuilder,
  target: number,
  environment?: number,
): number {
  const id = b.next(),
    slot = b.slot("reference");
  b.emit({
    kind: "function-new",
    id,
    target,
    ...(environment === undefined ? {} : { environment: b.load(environment) }),
    ...s,
  });
  b.save(slot, id);
  return slot;
}
function receiver(b: FunctionBuilder, slot: number): number {
  const id = b.next(),
    object = b.slot("reference");
  b.emit({
    kind: "general-value",
    id,
    value: b.load(slot),
    type: "reference",
    ...s,
  });
  b.save(object, id);
  return object;
}
function environment(b: FunctionBuilder): number {
  const id = b.next(),
    slot = b.slot("reference");
  b.emit({ kind: "closure-environment", id, ...s });
  b.save(slot, id);
  return slot;
}
function state(b: FunctionBuilder, constructor: number): number {
  const optional = b.next(),
    id = b.next(),
    slot = b.slot("reference");
  b.emit({
    kind: "function-environment",
    id: optional,
    callee: b.load(constructor),
    ...s,
  });
  b.emit({ kind: "reference-value", id, value: optional, ...s });
  b.save(slot, id);
  return slot;
}
function absent(b: FunctionBuilder, cell: number, trap: number): void {
  const next = b.block(),
    slot = b.slot("reference");
  b.end({
    kind: "record-cell",
    object: b.load(cell),
    record: 4,
    field: 0,
    operation: "read",
    slot,
    consequent: trap,
    alternate: next,
    ...s,
  });
  b.at(next);
}
export function classDefinitionFixture(throwStatic = false): {
  module: ModuleIR;
  bytes: number;
} {
  const signatures = [
    { parameters: ["number"], returnType: "number" },
    { parameters: [], returnType: "reference" },
    { parameters: [], returnType: "reference" },
    { parameters: [], returnType: "void" },
    { parameters: [], returnType: "number" },
    { parameters: [], returnType: "number" },
    { parameters: [], returnType: "number" },
    { parameters: [], returnType: "void" },
  ] as const;
  const definition = buildClassDefinition(
    {
      id: 1,
      name: "defineBox",
      environment: 3,
      prototype: {
        record: 0,
        constructorField: 0,
        methods: [{ field: 1, source: 2 }],
      },
      state: {
        record: 1,
        prototypeField: 0,
        constructionField: 1,
        methods: [],
      },
      callTarget: 7,
      construction: {
        target: 2,
        record: 2,
        receiverField: 0,
        entries: [{ field: 1, source: 4 }],
      },
      statics: {
        target: 3,
        record: 5,
        receiverField: 0,
        entries: [{ field: 1, source: 3 }],
      },
      innerBinding: { source: 0, record: 4, field: 0 },
      outerBinding: { source: 1, record: 4, field: 0 },
      ...s,
    },
    records,
    signatures,
  );
  const construction = buildClassConstruction(
    {
      id: 2,
      name: "constructBox",
      parameters: [],
      environment: 2,
      prototypeField: 0,
      instance: 6,
      instancePrototypeField: 0,
      fields: [
        { kind: "call", field: 1, entry: { field: 1, target: 5 }, ...s },
      ],
      ...s,
    },
    records,
    signatures,
  );
  const statics = buildClassStaticInitialization(
    {
      id: 3,
      name: "initializeBox",
      environment: 5,
      constructorField: 0,
      state: 1,
      fields: [
        { kind: "call", field: 2, entry: { field: 1, target: 4 }, ...s },
      ],
      ...s,
    },
    records,
    signatures,
  );
  const init = createFunctionBuilder(4, "staticField", [], "number");
  const thisSlot = init.slot("general"),
    initTrap = init.block(),
    initEnv = environment(init);
  const inner = read(init, initEnv, 7, 0, initTrap),
    outer = read(init, initEnv, 7, 1, initTrap);
  const innerValue = read(init, inner, 4, 0, initTrap),
    thisValue = receiver(init, thisSlot);
  equal(init, init.load(innerValue), init.load(thisValue), initTrap);
  absent(init, outer, initTrap);
  init.end(
    throwStatic
      ? { kind: "throw-literal", value: "static failure", ...s }
      : { kind: "return", value: number(init, 42), ...s },
  );
  init.at(initTrap);
  init.end({ kind: "trap", ...s });
  const instanceInit = createFunctionBuilder(5, "instanceField", [], "number");
  instanceInit.end({ kind: "return", value: number(instanceInit, 42), ...s });
  const method = createFunctionBuilder(6, "method", [], "number");
  const methodThis = method.slot("general"),
    methodTrap = method.block(),
    object = receiver(method, methodThis),
    field = read(method, object, 6, 1, methodTrap);
  method.end({ kind: "return", value: method.load(field), ...s });
  method.at(methodTrap);
  method.end({ kind: "trap", ...s });
  const call = createFunctionBuilder(7, "classCall", [], "void");
  call.end({ kind: "trap", ...s });
  const b = createFunctionBuilder(0, "run", ["number"], "number"),
    trap = b.block();
  const innerCell = allocate(b, 4, [undefined]),
    outerCell = allocate(b, 4, [undefined]);
  const methodClosure = closure(b, 6),
    initEnvSlot = allocate(b, 7, [innerCell, outerCell]);
  const staticClosure = closure(b, 4, initEnvSlot),
    instanceClosure = closure(b, 5);
  const definitionEnv = allocate(b, 3, [
      innerCell,
      outerCell,
      methodClosure,
      staticClosure,
      instanceClosure,
    ]),
    define = closure(b, 1, definitionEnv);
  const invokeDefinition = b.block();
  b.end({ kind: "jump", target: invokeDefinition, ...s });
  b.at(invokeDefinition);
  const constructorId = b.next(),
    constructor = b.slot("reference");
  b.emit({
    kind: "call-indirect",
    id: constructorId,
    target: 1,
    callee: b.load(define),
    arguments: [],
    ...s,
  });
  b.save(constructor, constructorId);
  const resultCell = read(b, outerCell, 4, 0, trap);
  equal(b, b.load(resultCell), b.load(constructor), trap);
  const constructorState = state(b, constructor),
    proto = read(b, constructorState, 1, 0, trap),
    constructionClosure = read(b, constructorState, 1, 1, trap),
    staticValue = read(b, constructorState, 1, 2, trap);
  equal(b, b.load(staticValue), number(b, 42), trap);
  const backref = read(b, proto, 0, 0, trap);
  equal(b, b.load(backref), b.load(constructor), trap);
  const instances: number[] = [];
  for (let i = 0; i < 2; i++) {
    const id = b.next(),
      slot = b.slot("reference");
    b.emit({
      kind: "call-indirect",
      id,
      target: 2,
      callee: b.load(constructionClosure),
      arguments: [],
      ...s,
    });
    b.save(slot, id);
    instances.push(slot);
    const ownProto = read(b, slot, 6, 0, trap);
    equal(b, b.load(ownProto), b.load(proto), trap);
    const ownMethod = read(b, ownProto, 0, 1, trap);
    equal(b, b.load(ownMethod), b.load(methodClosure), trap);
  }
  const first = instances[0],
    second = instances[1];
  if (first === undefined || second === undefined) throw "fixture instance";
  const modified = b.slot("number"),
    next = b.block();
  b.save(modified, number(b, 10));
  b.end({
    kind: "record-cell",
    object: b.load(first),
    record: 6,
    field: 1,
    operation: "write",
    slot: modified,
    consequent: next,
    alternate: trap,
    ...s,
  });
  b.at(next);
  const receiverId = b.next();
  b.emit({ kind: "general-wrap", id: receiverId, value: b.load(second), ...s });
  const result = b.next();
  b.emit({
    kind: "call-indirect",
    id: result,
    target: 6,
    callee: b.load(methodClosure),
    receiver: receiverId,
    arguments: [],
    ...s,
  });
  b.end(
    throwStatic
      ? { kind: "trap", ...s }
      : { kind: "return", value: result, ...s },
  );
  b.at(trap);
  b.end({ kind: "trap", ...s });
  const caught = b.slot("general"),
    handler = b.block();
  b.at(handler);
  const error = b.next(),
    expected = b.next();
  b.emit({
    kind: "general-value",
    id: error,
    value: b.load(caught),
    type: "string",
    ...s,
  });
  b.emit({
    kind: "string-literal",
    id: expected,
    value: "static failure",
    ...s,
  });
  equal(b, error, expected, trap);
  read(b, innerCell, 4, 0, trap);
  absent(b, outerCell, trap);
  b.end(
    throwStatic
      ? { kind: "return", value: number(b, 42), ...s }
      : { kind: "trap", ...s },
  );
  const run = b.finish();
  return {
    bytes: throwStatic ? 672 : 768,
    module: {
      records,
      functions: [
        {
          ...run,
          exported: true,
          blocks: run.blocks.map((block) =>
            block.instructions.some(
              (op) => op.kind === "call-indirect" && op.target === 1,
            )
              ? { ...block, exception: { target: handler, slot: caught } }
              : block,
          ),
        },
        definition,
        construction,
        statics,
        { ...init.finish(), closureEnvironment: 7, receiverSlot: thisSlot },
        instanceInit.finish(),
        { ...method.finish(), receiverSlot: methodThis },
        { ...call.finish(), closureEnvironment: 1 },
      ],
    },
  };
}
