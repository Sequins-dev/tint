interface Receiver {
  offset: number;
  add(value: number): number;
}

function firstReceivers() {
  return [
    {
      offset: 1,
      add(value: number) {
        return this.offset + value;
      },
    },
    {
      label: "b",
      offset: 2,
      add(value: number) {
        return value + this.offset;
      },
    },
    {
      offset: 3,
      extra: true,
      add(value: number) {
        return value + this.offset;
      },
    },
    {
      add(value: number) {
        return this.offset + value;
      },
      offset: 4,
    },
  ];
}

export function receivers2(iterations: number): number {
  const list: Receiver[] = firstReceivers();
  let sum = 0;
  for (let i = 0; i < iterations; i++) sum += list[i & 1]!.add(i & 7);
  return sum;
}

export function receivers4(iterations: number): number {
  const list: Receiver[] = firstReceivers();
  let sum = 0;
  for (let i = 0; i < iterations; i++) sum += list[i & 3]!.add(i & 7);
  return sum;
}

export function receivers8(iterations: number): number {
  const list: Receiver[] = firstReceivers();
  const other = [
    {
      offset: 5,
      add(value: number) {
        return this.offset + value;
      },
      e: 0,
    },
    {
      f: 0,
      add(value: number) {
        return this.offset + value;
      },
      offset: 6,
    },
    {
      offset: 7,
      g: 0,
      add(value: number) {
        return this.offset + value;
      },
    },
    {
      h: 0,
      offset: 8,
      add(value: number) {
        return this.offset + value;
      },
    },
  ];
  list.push(...other);
  let sum = 0;
  for (let i = 0; i < iterations; i++) sum += list[i & 7]!.add(i & 7);
  return sum;
}

function three(a: number, b: number, c: number): number {
  return a + b * 2 + c * 3;
}

function four(a: number, b: number, c: number, d: number): number {
  return a + b * 2 + c * 3 + d * 4;
}

function five(a: number, b: number, c: number, d: number, e: number): number {
  return a + b * 2 + c * 3 + d * 4 + e * 5;
}

function six(
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
): number {
  return a + b * 2 + c * 3 + d * 4 + e * 5 + f * 6;
}

export function arguments3(iterations: number): number {
  const functions = { operation: three };
  let sum = 0;
  for (let i = 0; i < iterations; i++)
    sum += functions.operation(i & 7, i & 1, 1);
  return sum;
}

export function arguments4(iterations: number): number {
  const functions = { operation: four };
  let sum = 0;
  for (let i = 0; i < iterations; i++)
    sum += functions.operation(i & 7, i & 1, 1, 1);
  return sum;
}

export function arguments5(iterations: number): number {
  const functions = { operation: five };
  let sum = 0;
  for (let i = 0; i < iterations; i++)
    sum += functions.operation(i & 7, i & 1, 1, 1, 1);
  return sum;
}

export function arguments6(iterations: number): number {
  const functions = { operation: six };
  let sum = 0;
  for (let i = 0; i < iterations; i++)
    sum += functions.operation(i & 7, i & 1, 1, 1, 1, 1);
  return sum;
}

interface RecordValue {
  left: number;
  right: number;
}

function update(record: RecordValue, value: number): RecordValue {
  record.left = value;
  return record;
}

function makeRecord(value: number): RecordValue {
  return { left: value, right: value + 1 };
}

export function objectRoundTrip(iterations: number): number {
  const object = { left: 0, right: 2 };
  let sum = 0;
  for (let i = 0; i < iterations; i++) {
    const returned = update(object, i & 7);
    if (returned !== object) throw new Error("object identity");
    sum += returned.left + returned.right;
  }
  return sum;
}

export function allocateObjects(iterations: number): number {
  const initial = { left: 0, right: 1 };
  const retained = [
    initial,
    initial,
    initial,
    initial,
    initial,
    initial,
    initial,
    initial,
  ];
  let sum = 0;
  for (let i = 0; i < iterations; i++) {
    const record = makeRecord(i & 15);
    const previous = retained[i & 7]!;
    retained[i & 7] = record;
    sum += previous.right + record.left;
  }
  for (const record of retained) sum += record.right;
  return sum;
}

function makeExchange(initial: string): (value: string) => string {
  let previous = initial;
  return (value: string): string => {
    const returned = previous;
    previous = value;
    return returned;
  };
}

export function mutableCapture(iterations: number): number {
  const exchange = makeExchange("sun");
  let sum = 0;
  for (let i = 0; i < iterations; i++)
    sum += exchange((i & 1) === 0 ? "oak" : "ash!").length;
  return sum;
}

export function concatenateStrings(iterations: number): number {
  let sum = 0;
  for (let i = 0; i < iterations; i++) {
    const prefix = (i & 1) === 0 ? "oak" : "ash";
    const text = prefix + "!!";
    sum += text.length;
    if (text === "oak!!") sum++;
  }
  return sum;
}

export function buildString(iterations: number): number {
  let text = "";
  let sum = 0;
  for (let i = 0; i < iterations; i++) {
    text += (i & 1) === 0 ? "a" : "bc";
    if ((i & 15) === 15) {
      sum += text.length + (text.charAt(10) === "b" ? 1 : 0);
      text = "";
    }
  }
  return sum + text.length;
}

function mayThrow(value: number): number {
  if ((value & 63) === 0) throw 5;
  return value & 7;
}

export function catchInLoop(iterations: number): number {
  let sum = 0;
  for (let i = 0; i < iterations; i++) {
    try {
      sum += mayThrow(i);
    } catch (caught) {
      if (typeof caught !== "number") throw caught;
      sum += caught;
    }
  }
  return sum;
}

export function objectArray(iterations: number): number {
  const values = [
    { x: 1, y: 10 },
    { x: 2, y: 11 },
    { x: 3, y: 12 },
    { x: 4, y: 13 },
    { x: 5, y: 14 },
    { x: 6, y: 15 },
    { x: 7, y: 16 },
    { x: 8, y: 17 },
  ];
  let sum = 0;
  for (let i = 0; i < iterations; i++) {
    const value = values[i & 7]!;
    sum += value.x + value.y;
  }
  return sum;
}

function score(value: number | string | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return value.length;
  return 2;
}

export function mixedCall(iterations: number): number {
  let sum = 0;
  for (let i = 0; i < iterations; i++) {
    const lane = i % 3;
    const value = lane === 0 ? i & 7 : lane === 1 ? "oak" : undefined;
    sum += score(value);
  }
  return sum;
}

// Untyped calls of builtins: a constructor called as a function, a static
// method of a builtin namespace object, and a method of a builtin-created
// object (realm objects and their prototypes).
export function numberCall(iterations: number): number {
  let sum = 0;
  for (let i = 0; i < iterations; i++) sum += Number(i & 7);
  return sum;
}

export function mathMax(iterations: number): number {
  let sum = 0;
  for (let i = 0; i < iterations; i++) sum += Math.max(i & 7, 3);
  return sum;
}

export function builtinMethod(iterations: number): number {
  const map = new Map<number, number>();
  for (let key = 0; key < 4; key++) map.set(key, key * 2);
  let sum = 0;
  for (let i = 0; i < iterations; i++) sum += map.get(i & 3)!;
  return sum;
}
