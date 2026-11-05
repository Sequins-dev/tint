import type { AArch64AddressReference as AddressReference } from "@tint/codegen/aarch64/image-relocations";
import type { AArch64ExecutableRequest as ExecutableRequest } from "./aarch64-executable.ts";
import { buildAArch64Executable } from "./aarch64-executable.ts";
import assert from "node:assert/strict";
import {
  writeInstruction,
  relativeAddress,
  patchBranch,
  patchAddress,
  type Instruction,
} from "@tint/codegen/aarch64/isa";
/** Process-local SIGTRAP handling for native tests; production code is unchanged. */
export const nativeTrapStatus = 133;
export const nativeTrapSetupFailure = 126;
export function handleNativeTestTraps(
  request: ExecutableRequest,
): ExecutableRequest {
  const prefix = request.code.length;
  assert.equal(prefix % 4, 0);
  const instructions: Instruction[] = [];
  const fixups: AddressReference[] = [...(request.addressFixups ?? [])];
  const emit = (instruction: Instruction) => instructions.push(instruction);
  const position = () => prefix + instructions.length * 4;
  const importCall = (name: string, tail = false) => {
    fixups.push({
      offset: position(),
      rd: 16,
      scratch: 17,
      target: { kind: "import", name },
    });
    const pointer = relativeAddress(16, 17, 0);
    assert.ok(pointer.ok);
    pointer.value.forEach(emit);
    emit({ op: "ldr", width: 64, rt: 16, rn: 16, offset: 0 });
    emit({ op: tail ? "br" : "blr", rn: 16 });
  };
  // Preserve main's argc/argv and return address across signal().
  emit({
    op: "stp",
    width: 64,
    rt: 29,
    rt2: 30,
    rn: "sp",
    offset: -32,
    mode: "pre",
  });
  emit({
    op: "stp",
    width: 64,
    rt: 0,
    rt2: 1,
    rn: "sp",
    offset: 16,
    mode: "offset",
  });
  emit({ op: "movz", width: 32, rd: 0, immediate: 5, shift: 0 });
  const handlerAddress = position();
  emit({ op: "adr", rd: 1, displacement: 0 });
  importCall("_signal");
  // SIG_ERR is -1. Return a distinct failure if installation fails.
  emit({
    op: "add-imm",
    width: 64,
    rd: 0,
    rn: 0,
    immediate: 1,
    shift: 0,
    setFlags: false,
  });
  const installed = position();
  emit({ op: "cbnz", width: 64, rt: 0, displacement: 0 });
  emit({
    op: "movz",
    width: 32,
    rd: 0,
    immediate: nativeTrapSetupFailure,
    shift: 0,
  });
  emit({
    op: "ldp",
    width: 64,
    rt: 29,
    rt2: 30,
    rn: "sp",
    offset: 32,
    mode: "post",
  });
  emit({ op: "ret", rn: 30 });
  const success = position();
  emit({
    op: "ldp",
    width: 64,
    rt: 0,
    rt2: 1,
    rn: "sp",
    offset: 16,
    mode: "offset",
  });
  emit({
    op: "ldp",
    width: 64,
    rt: 29,
    rt2: 30,
    rn: "sp",
    offset: 32,
    mode: "post",
  });
  const entryBranch = position();
  emit({ op: "b", displacement: 0 });
  const handler = position();
  emit({ op: "movz", width: 32, rd: 0, immediate: nativeTrapStatus, shift: 0 });
  // _exit is async-signal-safe; its Mach-O symbol has two leading underscores.
  importCall("__exit", true);
  const code = new Uint8Array(prefix + instructions.length * 4);
  code.set(request.code);
  instructions.forEach((instruction, index) =>
    assert.ok(writeInstruction(code, prefix + index * 4, instruction).ok),
  );
  assert.ok(
    patchAddress(code, { offset: handlerAddress, targetOffset: handler, rd: 1 })
      .ok,
  );
  assert.ok(
    patchBranch(code, {
      offset: installed,
      targetOffset: success,
      branch: { op: "cbnz", width: 64, rt: 0 },
    }).ok,
  );
  assert.ok(
    patchBranch(code, {
      offset: entryBranch,
      targetOffset: request.entryOffset,
      branch: { op: "b" },
    }).ok,
  );
  return {
    ...request,
    allowDebugger: true,
    code,
    entryOffset: prefix,
    addressFixups: fixups,
    imports: [...new Set([...(request.imports ?? []), "_signal", "__exit"])],
  };
}
