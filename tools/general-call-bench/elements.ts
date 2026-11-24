// Untyped element access and builtin calls (step 5 of the general runtime
// re-architecture): packed number and object elements read, written and
// updated in place, String and Math builtins, and Map and Set methods.

function numberArray(): number[] {
  const values: number[] = [];
  for (let i = 0; i < 1024; i++) values.push(i * 0.5);
  return values;
}

export function numberElementRead(iterations: number): number {
  const values = numberArray();
  let sum = 0;
  for (let i = 0; i < iterations; i++) sum += values[i & 1023]!;
  return sum;
}

export function numberElementWrite(iterations: number): number {
  const values = numberArray();
  for (let i = 0; i < iterations; i++) values[i & 1023] = i & 7;
  let sum = 0;
  for (let i = 0; i < 1024; i++) sum += values[i]!;
  return sum;
}

export function numberElementUpdate(iterations: number): number {
  const values = numberArray();
  for (let i = 0; i < iterations; i++) values[i & 1023]! += 1;
  let sum = 0;
  for (let i = 0; i < 1024; i++) sum += values[i]!;
  return sum;
}

export function objectElementRead(iterations: number): number {
  const values: { x: number }[] = [];
  for (let i = 0; i < 64; i++) values.push({ x: i });
  let sum = 0;
  for (let i = 0; i < iterations; i++) sum += values[i & 63]!.x;
  return sum;
}

export function mathFloor(iterations: number): number {
  let sum = 0;
  for (let i = 0; i < iterations; i++) sum += Math.floor(i * 0.25);
  return sum;
}

export function mathSqrt(iterations: number): number {
  let sum = 0;
  for (let i = 0; i < iterations; i++) sum += Math.sqrt(i & 1023) > 16 ? 1 : 0;
  return sum;
}

export function charCodeAt(iterations: number): number {
  const text = "abcdefghijklmnop";
  let sum = 0;
  for (let i = 0; i < iterations; i++) sum += text.charCodeAt(i & 15);
  return sum;
}

export function mapSetHas(iterations: number): number {
  const map = new Map<number, number>();
  let sum = 0;
  for (let i = 0; i < iterations; i++) {
    map.set(i & 63, i & 7);
    if (map.has(i & 127)) sum++;
  }
  return sum + map.size;
}

export function setAddHas(iterations: number): number {
  const set = new Set<number>();
  let sum = 0;
  for (let i = 0; i < iterations; i++) {
    set.add(i & 63);
    if (set.has(i & 127)) sum++;
  }
  return sum + set.size;
}
