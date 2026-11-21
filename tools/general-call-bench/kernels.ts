export function control(iterations: number): number {
  const operation = (): number => 42;
  let sum = 0;
  for (let i = 0; i < iterations; i++) sum += operation();
  return sum;
}

export function closure(iterations: number): number {
  function makeAdder(offset: number): (value: number) => number {
    return (value: number): number => value + offset;
  }
  const add = makeAdder(7);
  let sum = 0;
  for (let i = 0; i < iterations; i++) sum += add(i & 15);
  return sum;
}

export function method(iterations: number): number {
  const object = {
    offset: 7,
    add(this: { offset: number }, value: number): number {
      return this.offset + value;
    },
  };
  let sum = 0;
  for (let i = 0; i < iterations; i++) sum += object.add(i & 15);
  return sum;
}

export function property(iterations: number): number {
  const object = { value: 0 };
  let sum = 0;
  for (let i = 0; i < iterations; i++) {
    object.value = i & 15;
    sum += object.value;
  }
  return sum + object.value;
}

export function array(iterations: number): number {
  const values: number[] = [1, 4, 2, 8, 5, 7, 6, 3];
  let sum = 0;
  for (let i = 0; i < iterations; i++) sum += values[i & 7] ?? 0;
  return sum;
}

export function stringEquality(iterations: number): number {
  let sum = 0;
  for (let i = 0; i < iterations; i++) {
    const text: string = (i & 1) === 0 ? "match" : "other";
    if (text === "match") sum++;
  }
  return sum;
}

export function rest(iterations: number): number {
  function add(...values: number[]): number {
    return (values[0] ?? 0) + (values[1] ?? 0) + values.length;
  }
  let sum = 0;
  for (let i = 0; i < iterations; i++) sum += add(i & 15, 7);
  return sum;
}

export function recursive(iterations: number): number {
  function fib(value: number): number {
    if (value < 2) return value;
    return fib(value - 1) + fib(value - 2);
  }
  let sum = 0;
  for (let i = 0; i < iterations; i++) sum += fib(8 + (i & 1));
  return sum;
}
