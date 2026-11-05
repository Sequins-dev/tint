import type {
  ModuleIR,
  FunctionIR,
  Instruction,
  ScalarType,
} from "@tint/ir/scalar";
const span = { start: 0, end: 0 };
/** Shared IR fixtures exercise the native ABI independently of source closure lowering. */
export function functionValueFixture(
  type: ScalarType,
  count: number,
): ModuleIR {
  const parameters = Array.from({ length: count }, (_, i) => i);
  const identity: FunctionIR = {
    id: 0,
    name: "identity",
    exported: false,
    parameters,
    slots: parameters.map(() => type),
    returnType: type,
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "load", id: 0, slot: count - 1, ...span }],
        terminator: { kind: "return", value: 0, ...span },
      },
    ],
  };
  const apply: FunctionIR = {
    id: 2,
    name: "apply",
    exported: false,
    parameters: [0, ...parameters.map((i) => i + 1)],
    slots: ["reference", ...parameters.map(() => type)],
    returnType: type,
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...span },
          ...parameters.map((i) => ({
            kind: "load" as const,
            id: i + 1,
            slot: i + 1,
            ...span,
          })),
          {
            kind: "call-indirect",
            id: count + 1,
            target: 1,
            callee: 0,
            arguments: parameters.map((i) => i + 1),
            ...span,
          },
        ],
        terminator: { kind: "return", value: count + 1, ...span },
      },
    ],
  };
  const instructions: Instruction[] = [
    { kind: "function-new", id: 0, target: 0, ...span },
  ];
  let next = 1;
  const args: number[] = [];
  for (let i = 0; i < count; i++) {
    const id = next++;
    if (type === "string")
      instructions.push({
        kind: "string-literal",
        id,
        value: "argument" + i,
        ...span,
      });
    else if (type === "reference")
      instructions.push({
        kind: "record-new",
        id,
        record: 0,
        arguments: [],
        ...span,
      });
    else {
      instructions.push({ kind: "constant", id, value: i + 1, ...span });
      if (type === "optional-number") {
        const wrapped = next++;
        instructions.push({
          kind: "optional-wrap",
          id: wrapped,
          value: id,
          ...span,
        });
        args.push(wrapped);
        continue;
      }
    }
    args.push(id);
  }
  const last = args.at(-1);
  if (last === undefined) throw "fixture needs arguments";
  const result = next++,
    equal = next++;
  instructions.push(
    { kind: "call", id: result, target: 2, arguments: [0, ...args], ...span },
    {
      kind: "binary",
      id: equal,
      operator: "===",
      left: result,
      right: last,
      ...span,
    },
  );
  return {
    records: [{ byteLength: 32, fields: [] }],
    functions: [
      identity,
      { ...identity, id: 1, name: "witness" },
      apply,
      {
        id: 3,
        name: "run",
        exported: true,
        parameters: [0],
        slots: ["number"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions,
            terminator: {
              kind: "branch",
              condition: equal,
              consequent: 1,
              alternate: 2,
              ...span,
            },
          },
          {
            id: 1,
            instructions: [{ kind: "constant", id: next, value: 1, ...span }],
            terminator: { kind: "return", value: next, ...span },
          },
          {
            id: 2,
            instructions: [
              { kind: "constant", id: next + 1, value: -1, ...span },
            ],
            terminator: { kind: "return", value: next + 1, ...span },
          },
        ],
      },
    ],
  };
}
