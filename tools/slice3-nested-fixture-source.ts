export const nestedCaptureSource = `function activation(seed: number): (delta: number) => number {
  let count: number = seed;
  function bump(delta: number): number {
    count += delta;
    return count;
  }
  const alias = bump;
  function general(delta: number): number {
    if (arguments.length !== 1 || bump !== alias) return -1;
    count += 1;
    return alias(delta);
  }
  return general;
}
export function run(): number {
  const first = activation(1);
  const second = activation(10);
  if (first(1) !== 3 || second(1) !== 12) return 1;
  return first(38) === 42 ? 42 : 2;
}`;

// The invalid write crosses a checked annotation through an erasure. Node
// accepts that write, so this fixture has a separate reference result.
export const nestedContractSource = `export function run(): number {
  let count: number = 20;
  function nativeAdd(delta: number): number {
    count += delta;
    return count;
  }
  function general(delta: number): number {
    if (arguments.length !== 1) return 2;
    const marker = {};
    let rejected = false;
    try { count = "wrong" as unknown as number; }
    catch (error) { rejected = error instanceof TypeError; }
    if (!rejected || count !== 20) return 3;
    try { throw marker; } catch (error) { if (error !== marker) return 4; }
    return nativeAdd(delta);
  }
  return general(22);
}`;

export const nestedIterationSource = `export function run(): number {
  const saved: ((delta: number) => number)[] = [];
  let early = 0;
  for (let index = 0; index < 2; index++) {
    function nativeAdd(delta: number): number {
      count += delta;
      return count;
    }
    function general(delta: number): number {
      return nativeAdd(delta + arguments.length);
    }
    try { general(0); } catch (error) { if (error instanceof ReferenceError) early++; }
    let count: number = index;
    saved.push(general);
  }
  return early === 2 && saved[0]?.(19) === 20 && saved[1]?.(20) === 22 ? 42 : 1;
}`;
