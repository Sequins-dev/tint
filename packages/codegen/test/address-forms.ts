import assert from "node:assert/strict";
import { encode, relativeAddress } from "../src/aarch64/isa.ts";
/** Whether the instruction(s) at `offset` load `target`'s address into `rd`:
 * a single in-reach ADR, or the four-instruction long form that starts there. */
export function addressesTarget(
  view: DataView,
  offset: number,
  rd: number,
  target: number,
): boolean {
  if (offset < 0 || offset + 4 > view.byteLength) return false;
  const adr = encode({ op: "adr", rd, displacement: target - offset });
  if (adr.ok && view.getUint32(offset, true) === adr.value) return true;
  if (offset + 16 > view.byteLength) return false;
  const sequence = relativeAddress(rd, 17, target - offset);
  assert.ok(sequence.ok);
  return sequence.value.every((instruction, index) => {
    const word = encode(instruction);
    assert.ok(word.ok);
    return view.getUint32(offset + index * 4, true) === word.value;
  });
}
