import { encodeLayout, writeRel32, type Instruction } from "../isa.ts";
import {
  gpr,
  imm,
  label,
  mem,
  normal,
  resultBytes,
  resultPayload,
  word,
} from "./machine.ts";

export type ExitResult = "number" | "boolean" | "void";

/** Append an exit-only Linux entry. The initial process stack is 16-byte
 * aligned. Reserve a managed completion area and pass null hidden inputs. */
export function appendExitEntry(
  body: Uint8Array,
  target: number,
  returnType: ExitResult,
): Uint8Array {
  const rsp = gpr(4),
    eax = word(0),
    edi = word(7),
    rdi = gpr(7);
  const ebp = word(5),
    esi = word(6),
    edx = word(2);
  const instructions: Instruction[] = [
    { op: "sub", dst: rsp, src: imm(resultBytes) },
    { op: "xor", dst: ebp, src: ebp },
    { op: "xor", dst: edi, src: edi },
    { op: "xor", dst: esi, src: esi },
    { op: "xor", dst: edx, src: edx },
    { op: "mov", dst: gpr(1), src: rsp },
    { op: "mov", dst: mem(4, 0), src: imm(0) },
    { op: "mov", dst: mem(4, 8), src: imm(0) },
    { op: "call", target: label("entry") },
    { op: "cmp", dst: eax, src: imm(normal) },
    { op: "jcc", cc: "ne", target: label("failure") },
  ];
  if (returnType === "number") {
    instructions.push({
      op: "cvttsd2si",
      dst: rdi,
      src: mem(4, resultPayload),
    });
    instructions.push({ op: "cmp", dst: rdi, src: imm(255) });
    instructions.push({ op: "jcc", cc: "a", target: label("failure") });
  } else if (returnType === "boolean")
    instructions.push({ op: "mov", dst: rdi, src: mem(4, resultPayload) });
  else instructions.push({ op: "xor", dst: edi, src: edi });
  instructions.push({ op: "jmp", target: label("exit") });
  instructions.push({ op: "label", name: "failure" });
  instructions.push({ op: "mov", dst: edi, src: imm(1) });
  instructions.push({ op: "label", name: "exit" });
  instructions.push({ op: "mov", dst: eax, src: imm(60) });
  instructions.push({ op: "syscall" });
  instructions.push({ op: "ud2" });

  const external = (name: string): boolean => name === "entry";
  const stub = encodeLayout(instructions, external);
  const base = body.length;
  const code = new Uint8Array(base + stub.bytes.length);
  code.set(body);
  code.set(stub.bytes, base);
  const fixup = stub.externalFixups[0];
  if (fixup === undefined) throw "entry call fixup invariant";
  writeRel32(code, base + fixup.fieldOffset, base + fixup.nextOffset, target);
  return code;
}
