/** The integer transcode shared by the two native ASCII block kernels.
 * Pointers and the remaining counts refer to an already checked window.
 * Destination writes are bounded before committing any bytes of a scalar. */
export interface Utf8WindowLoop {
  readonly source: number;
  readonly destination: number;
  readonly units: number;
  readonly space: number;
  readonly value: number;
  readonly temp: number;
  readonly label: (name: string) => void;
  readonly jump: (name: string) => void;
  readonly below: (register: number, value: number, name: string) => void;
  readonly atLeast: (register: number, value: number, name: string) => void;
  readonly move: (to: number, from: number) => void;
  readonly constant: (register: number, value: number) => void;
  readonly add: (register: number, value: number) => void;
  readonly sub: (register: number, value: number) => void;
  readonly addRegister: (register: number, added: number) => void;
  readonly shiftLeft: (register: number, bits: number) => void;
  readonly shiftRight: (register: number, bits: number) => void;
  readonly keepLow: (register: number, bits: number) => void;
  readonly loadUnit: (register: number, offset: number) => void;
  readonly storeByte: (register: number, offset: number) => void;
  /** Copy eight units only when all are ASCII, else jump before any write. */
  readonly asciiBlock: (fallback: string) => void;
}

/** Emit through the done label, leaving the remaining counts in registers. */
export function emitUtf8WindowLoop(m: Utf8WindowLoop): void {
  const unit = m.value;
  const temp = m.temp;
  function advance(units: number, bytes: number): void {
    m.add(m.source, units * 2);
    m.add(m.destination, bytes);
    m.sub(m.units, units);
    m.sub(m.space, bytes);
  }
  function continuation(offset: number, shift: number): void {
    m.move(temp, unit);
    if (shift !== 0) m.shiftRight(temp, shift);
    m.keepLow(temp, 6);
    m.add(temp, 0x80);
    m.storeByte(temp, offset);
  }
  m.label("ascii-block");
  m.below(m.units, 8, "scalar");
  m.below(m.space, 8, "scalar");
  m.asciiBlock("scalar");
  advance(8, 8);
  m.jump("ascii-block");

  m.label("scalar");
  m.below(m.units, 1, "done");
  m.below(m.space, 1, "done");
  m.loadUnit(unit, 0);
  m.atLeast(unit, 0x80, "non-ascii");
  m.storeByte(unit, 0);
  advance(1, 1);
  m.jump("ascii-block");

  m.label("non-ascii");
  m.atLeast(unit, 0x800, "wide");
  m.below(m.space, 2, "done");
  continuation(1, 0);
  m.shiftRight(unit, 6);
  m.add(unit, 0xc0);
  m.storeByte(unit, 0);
  advance(1, 2);
  m.jump("scalar");

  m.label("wide");
  m.below(unit, 0xd800, "three-bytes");
  m.atLeast(unit, 0xe000, "three-bytes");
  m.atLeast(unit, 0xdc00, "replacement");
  m.below(m.units, 2, "replacement");
  m.loadUnit(temp, 2);
  m.below(temp, 0xdc00, "replacement");
  m.atLeast(temp, 0xe000, "replacement");
  m.below(m.space, 4, "done");
  m.keepLow(unit, 10);
  m.shiftLeft(unit, 10);
  m.keepLow(temp, 10);
  m.addRegister(unit, temp);
  m.add(unit, 0x10000);
  continuation(3, 0);
  continuation(2, 6);
  continuation(1, 12);
  m.shiftRight(unit, 18);
  m.add(unit, 0xf0);
  m.storeByte(unit, 0);
  advance(2, 4);
  m.jump("scalar");

  m.label("replacement");
  m.constant(unit, 0xfffd);
  m.label("three-bytes");
  m.below(m.space, 3, "done");
  continuation(2, 0);
  continuation(1, 6);
  m.shiftRight(unit, 12);
  m.add(unit, 0xe0);
  m.storeByte(unit, 0);
  advance(1, 3);
  m.jump("scalar");
  m.label("done");
}
