export const generalCallLoopSource = `
export function run() {
  if (typeof Reflect !== "object") return 1;

  // A local loop binding can hold any JavaScript value.
  let visits = "";
  for (let i = 0; i !== "stop"; i = i === 0 ? 1 : "stop") {
    visits += i;
  }
  if (visits !== "01") return 3;

  let signedZero = -0;
  for (let i = 0; i < 1; i++) signedZero += -0;
  if (1 / signedZero !== -Infinity) return 9;

  let coercions = 0;
  const operand = { valueOf() { coercions++; return 5; } };
  let number = 1;
  for (let i = 0; i < 2; i++) number += operand;
  if (number !== 11 || coercions !== 2) return 10;

  try {
    for (let tdz = tdz; false; ) {}
    return 11;
  } catch (error) {
    if (!(error instanceof ReferenceError)) return 12;
  }

  // An initializer closure retains the pre-iteration binding. The body
  // closure retains its iteration's binding after continue unwinds finally.
  let initial;
  let captured;
  let finalized = 0;
  for (let i = 0, getInitial = () => i; i < 2; i++) {
    initial = getInitial;
    if (i === 0) {
      captured = () => i;
      try {
        continue;
      } finally {
        finalized++;
      }
    }
  }
  if (initial() !== 0 || captured() !== 0 || finalized !== 1) return 4;

  const sentinel = {};
  let order = "";
  const receiver = {
    get method() {
      order += "get ";
      return function (a, b) {
        if (this !== receiver || a !== 1 || b !== 2 || arguments.length !== 2)
          return 5;
        order += "call";
        throw sentinel;
      };
    },
  };
  function argument(value) {
    order += value + " ";
    return value;
  }
  try {
    receiver.method(argument(1), argument(2));
    return 6;
  } catch (error) {
    if (error !== sentinel) return 7;
  }
  if (order !== "get 1 2 call") return 8;

  function numericSum(bound, step) {
    const next = value => value + 1;
    let total = 0;
    for (let i = 0; i < bound; i++) total += next(i) * step;
    return total;
  }
  if (numericSum(3, 2) !== 12 || numericSum("3", 2) !== 12 ||
      numericSum(3, "2") !== 12 || numericSum(NaN, 2) !== 0 ||
      numericSum(3) === numericSum(3) || numericSum(1, 2, 3) !== 2)
    return 13;
  let bounds = 0;
  if (numericSum({ valueOf() { bounds++; return 2; } }, 2) !== 6 ||
      bounds !== 3)
    return 14;
  try {
    numericSum({ valueOf() { throw sentinel; } }, 2);
    return 15;
  } catch (error) {
    if (error !== sentinel) return 16;
  }

  let next = value => value + 1;
  if (next(2) !== 3 || next("2") !== "21") return 17;
  function replace(value) { return value * 10; }
  if (next((next = replace, 2)) !== 3 || next(2) !== 20) return 18;
  const identity = value => value;
  if (1 / identity(-0) !== -Infinity) return 19;
  return 42;
}
`;

export const typedCallLoopSource = `
export function run(): number {
  const next = (value: number): number => value + 1;
  let sum: number = 0;
  for (let index: number = 0; index < 8; index++) {
    if (index === 2) continue;
    sum += next(index);
    if (index === 5) break;
  }
  return sum === 18 ? 42 : 1;
}
`;
