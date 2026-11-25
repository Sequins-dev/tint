import assert from "node:assert/strict";
import test from "node:test";
import { scriptArgumentLayout } from "../src/aarch64/scalar/abi.ts";
import {
  decodeStackMaps,
  emitModule,
  emitModuleFromStore,
} from "../src/aarch64/scalar/index.ts";
import { verify, type FunctionIR, type ModuleIR } from "@tint/ir/scalar";

test("a JavaScript entry takes an arbitrary actual count in register pairs and stack words", () => {
  assert.equal(scriptArgumentLayout(0).stackBytes, 0);
  assert.deepEqual(scriptArgumentLayout(1), {
    registerArguments: 1,
    stackBytes: 0,
  });
  assert.deepEqual(scriptArgumentLayout(3), {
    registerArguments: 3,
    stackBytes: 0,
  });
  assert.deepEqual(scriptArgumentLayout(7), {
    registerArguments: 7,
    stackBytes: 0,
  });
  assert.deepEqual(scriptArgumentLayout(10), {
    registerArguments: 7,
    stackBytes: 48,
  });
});

const span = { start: 0, end: 0 };
export const scriptCall: ModuleIR = {
  functions: [
    {
      id: 0,
      name: "source",
      exported: false,
      scriptEntry: true,
      parameters: [0, 1, 2, 3],
      slots: ["general", "general", "general", "optional-reference"],
      returnType: "general",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "script-argument-count", id: 0, ...span },
            { kind: "constant", id: 1, value: 1, ...span },
            {
              kind: "binary",
              id: 2,
              operator: "-",
              left: 0,
              right: 1,
              ...span,
            },
            {
              kind: "host-call",
              operation: "collect-garbage",
              id: undefined,
              arguments: [],
              ...span,
            },
            { kind: "script-argument", id: 3, index: 2, ...span },
          ],
          terminator: { kind: "return", value: 3, ...span },
        },
      ],
    },
    {
      id: 1,
      name: "main",
      exported: true,
      parameters: [],
      slots: [],
      returnType: "number",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "function-new", id: 0, target: 0, ...span },
            { kind: "general-none", id: 1, ...span },
            { kind: "constant", id: 2, value: 42, ...span },
            { kind: "general-wrap", id: 3, value: 2, ...span },
            { kind: "reference-none", id: 6, ...span },
            {
              kind: "call-indirect",
              id: 4,
              target: 0,
              callee: 0,
              arguments: [1, 1, 1, 6],
              scriptArguments: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 3],
              ...span,
            },
            { kind: "general-value", id: 5, type: "number", value: 4, ...span },
          ],
          terminator: { kind: "return", value: 5, ...span },
        },
      ],
    },
  ],
};

test("a variadic source call lowers its argument reads and roots its overflow area", () => {
  assert.ok(verify(scriptCall).ok);
  const emitted = emitModule(scriptCall, { closedRoots: [1] });
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const maps = decodeStackMaps(emitted.value);
  assert.ok(maps);
  const source = emitted.value.functions[0]!;
  const caller = emitted.value.functions[1]!;
  const inside = maps.find(
    (site) =>
      site.offset > source.offset &&
      site.offset <= source.offset + source.byteLength,
  );
  assert.ok(inside);
  // The activation record's callee and the seven register actuals.
  assert.equal(inside.generals.length, 8);
  assert.ok(
    maps.some(
      (site) =>
        site.offset > caller.offset &&
        site.offset <= caller.offset + caller.byteLength &&
        [0, 16, 32, 48].every((offset) => site.generals.includes(offset)),
    ),
  );
});

test("pure-leaf and lazy-activation script entries emit exact stack maps and layout", () => {
  const leafAndLazy: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "helper",
        exported: false,
        parameters: [0],
        slots: ["general"],
        returnType: "general",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              {
                kind: "host-call",
                operation: "collect-garbage",
                id: undefined,
                arguments: [],
                ...span,
              },
              { kind: "load", id: 0, slot: 0, ...span },
            ],
            terminator: { kind: "return", value: 0, ...span },
          },
        ],
      },
      {
        id: 1,
        name: "pureLeaf",
        exported: false,
        scriptEntry: true,
        parameters: [0, 1, 2, 3],
        slots: ["general", "general", "general", "optional-reference"],
        returnType: "general",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "constant", id: 0, value: 5, ...span },
              { kind: "script-argument", id: 1, index: 0, ...span },
            ],
            terminator: { kind: "return", value: 1, ...span },
          },
        ],
      },
      {
        id: 2,
        name: "lazyColdCall",
        exported: false,
        scriptEntry: true,
        parameters: [0, 1, 2, 3],
        slots: ["general", "general", "general", "optional-reference"],
        returnType: "general",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "constant", id: 0, value: 0, ...span },
              { kind: "script-argument", id: 1, index: 0, ...span },
              {
                kind: "call",
                id: 2,
                target: 0,
                arguments: [1],
                ...span,
              },
            ],
            terminator: { kind: "return", value: 2, ...span },
          },
        ],
      },
      {
        id: 3,
        name: "main",
        exported: true,
        parameters: [],
        slots: [],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "function-new", id: 0, target: 1, ...span },
              { kind: "function-new", id: 1, target: 2, ...span },
              { kind: "general-none", id: 2, ...span },
              { kind: "constant", id: 3, value: 9, ...span },
              { kind: "general-wrap", id: 4, value: 3, ...span },
              { kind: "reference-none", id: 5, ...span },
              {
                kind: "call-indirect",
                id: 6,
                target: 1,
                callee: 0,
                arguments: [2, 2, 2, 5],
                scriptArguments: [2, 2, 2, 2, 2, 4],
                ...span,
              },
              {
                kind: "call-indirect",
                id: 7,
                target: 2,
                callee: 1,
                arguments: [2, 2, 2, 5],
                scriptArguments: [4],
                ...span,
              },
              {
                kind: "general-value",
                id: 8,
                type: "number",
                value: 6,
                ...span,
              },
            ],
            terminator: { kind: "return", value: 8, ...span },
          },
        ],
      },
    ],
  };
  assert.ok(verify(leafAndLazy).ok);
  const emitted = emitModule(leafAndLazy, { closedRoots: [3] });
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const maps = decodeStackMaps(emitted.value);
  assert.ok(maps);
  const pureLeaf = emitted.value.functions[1]!;
  const lazyColdCall = emitted.value.functions[2]!;
  const leafSites = maps.filter(
    (site) =>
      site.offset > pureLeaf.offset &&
      site.offset <= pureLeaf.offset + pureLeaf.byteLength,
  );
  assert.equal(leafSites.length, 0);
  const lazySite = maps.find(
    (site) =>
      site.offset > lazyColdCall.offset &&
      site.offset <= lazyColdCall.offset + lazyColdCall.byteLength,
  );
  assert.ok(lazySite);
  // Activation callee + 7 register actual slots + live general arg temporary (id 1).
  assert.equal(lazySite.generals.length, 9);
});

test("lazy-activation direct calls link around non-leaf helpers and preserve x9 (new.target)", () => {
  const mod: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "pureHelper",
        exported: false,
        parameters: [0],
        slots: ["general"],
        returnType: "general",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
            terminator: { kind: "return", value: 0, ...span },
          },
        ],
      },
      {
        id: 1,
        name: "allocHelper",
        exported: false,
        parameters: [0],
        slots: ["general"],
        returnType: "general",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              {
                kind: "host-call",
                operation: "collect-garbage",
                id: undefined,
                arguments: [],
                ...span,
              },
              { kind: "load", id: 0, slot: 0, ...span },
            ],
            terminator: { kind: "return", value: 0, ...span },
          },
        ],
      },
      {
        id: 2,
        name: "callerPure",
        exported: false,
        scriptEntry: true,
        parameters: [0, 1, 2, 3],
        slots: ["general", "general", "general", "optional-reference"],
        returnType: "general",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "constant", id: 0, value: 0, ...span },
              { kind: "script-argument", id: 1, index: 0, ...span },
              { kind: "call", id: 2, target: 0, arguments: [1], ...span },
            ],
            terminator: { kind: "return", value: 2, ...span },
          },
        ],
      },
      {
        id: 3,
        name: "callerAlloc",
        exported: false,
        scriptEntry: true,
        parameters: [0, 1, 2, 3],
        slots: ["general", "general", "general", "optional-reference"],
        returnType: "general",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "constant", id: 0, value: 0, ...span },
              { kind: "script-argument", id: 1, index: 0, ...span },
              { kind: "call", id: 2, target: 1, arguments: [1], ...span },
            ],
            terminator: { kind: "return", value: 2, ...span },
          },
        ],
      },
      {
        id: 4,
        name: "readsNewTargetWith4Args",
        exported: false,
        scriptEntry: true,
        parameters: [0, 1, 2, 3],
        slots: ["general", "general", "general", "optional-reference"],
        returnType: "general",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 2, ...span },
              { kind: "constant", id: 1, value: 3, ...span },
              { kind: "script-argument", id: 2, index: 1, ...span },
            ],
            terminator: { kind: "return", value: 0, ...span },
          },
        ],
      },
    ],
  };
  assert.ok(verify(mod).ok);
  const emitted = emitModule(mod, { closedRoots: [2, 3, 4] });
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const callerPure = emitted.value.functions[2]!;
  const callerAlloc = emitted.value.functions[3]!;
  // callerAlloc must emit deferred extra-actual zeroing and activation
  // link/unlink around its call to allocHelper; callerPure skips them.
  assert.ok(
    callerAlloc.byteLength > callerPure.byteLength,
    `expected callerAlloc (${callerAlloc.byteLength}) > callerPure (${callerPure.byteLength})`,
  );
  // readsNewTargetWith4Args must spill d0..d7 using x10/x11, never clobbering
  // x9 (new.target payload) with `fmov x9, dN` (0x9e660009 + N*32).
  const fn4 = emitted.value.functions[4]!;
  const code = emitted.value.code;
  for (let off = fn4.offset; off < fn4.offset + fn4.byteLength; off += 4) {
    const word =
      (code[off]! |
        (code[off + 1]! << 8) |
        (code[off + 2]! << 16) |
        (code[off + 3]! << 24)) >>>
      0;
    const isFmovX9 = (word & 0xfffffc1f) === 0x9e660009;
    assert.equal(
      isFmovX9,
      false,
      `unexpected fmov x9, dN (0x${word.toString(16)}) at +${off - fn4.offset}`,
    );
  }
});

test("typed-only modules skip pureLeafNoActivation body sweeps", () => {
  const leaf: FunctionIR = {
    id: 0,
    name: "typedLeaf",
    exported: true,
    parameters: [0],
    slots: ["number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
        terminator: { kind: "return", value: 0, ...span },
      },
    ],
  };
  const scriptFn: FunctionIR = {
    id: 1,
    name: "scriptCaller",
    exported: false,
    scriptEntry: true,
    parameters: [0, 1, 2, 3],
    slots: ["general", "general", "general", "optional-reference"],
    returnType: "general",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
        terminator: { kind: "return", value: 0, ...span },
      },
    ],
  };
  const countGets = (mod: ModuleIR): number => {
    assert.ok(verify(mod).ok);
    let gets = 0;
    const stored = [...mod.functions];
    const bodies = {
      get: (id: number): FunctionIR => {
        if (id === 0) gets++;
        return stored[id]!;
      },
      put: (fn: FunctionIR): void => {
        stored[fn.id] = fn;
      },
      release: (): void => {},
    };
    const emitted = emitModuleFromStore(mod, bodies, {
      closedRoots: [0],
      compactAddresses: false,
    });
    assert.ok(emitted.ok, JSON.stringify(emitted));
    return gets;
  };
  const typedGets = countGets({ functions: [leaf] });
  const mixedGets = countGets({ functions: [leaf, scriptFn] });
  assert.equal(
    mixedGets,
    typedGets + 1,
    `expected typed-only emission (${typedGets}) to skip the pureLeafNoActivation sweep done for mixed modules (${mixedGets})`,
  );
});
