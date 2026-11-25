import test from "node:test";
import assert from "node:assert/strict";
import { hostParameters, hostReturnType, type ModuleIR } from "@tint/ir/scalar";
import { emitModule } from "../src/aarch64/scalar/index.ts";
import * as abi from "@tint/abi/host";
test("context-domain is an explicit numeric capability in the reserved context word", () => {
  // The stack limit (72), saved stack limit word (80) and activation top
  // (88) precede the domain, which remains the context's last word.
  assert.equal(abi.nativeStackLimitOffset, 72);
  assert.equal(abi.nativeEngineThrowOffset, 80);
  assert.equal(abi.nativeActivationTopOffset, 88);
  assert.equal(abi.nativeContextDomainOffset, 96);
  assert.equal(abi.nativeHostedContextByteLength, 104);
  assert.deepEqual(hostParameters("context-domain"), []);
  assert.equal(hostReturnType("context-domain"), "number");
  const module: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "domain",
        exported: true,
        parameters: [],
        slots: [],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              {
                kind: "host-call",
                operation: "context-domain",
                id: 0,
                arguments: [],
                start: 0,
                end: 0,
              },
            ],
            terminator: { kind: "return", value: 0, start: 0, end: 0 },
          },
        ],
      },
    ],
  };
  assert.ok(
    emitModule(module, { generationalBarriers: true }).ok,
    "reading context identity does not mutate managed layouts",
  );
  const emitted = emitModule(module);
  assert.ok(emitted.ok, JSON.stringify(emitted));
  if (emitted.ok)
    assert.equal(
      emitted.value.imports.length,
      0,
      "reading the issued domain itself needs no foreign call",
    );
});
