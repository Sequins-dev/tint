// Independent JavaScript numeric oracles, used only by native validation.
function literal(value: number): string {
  if (Number.isNaN(value)) return "(0/0)";
  if (value === Infinity) return "(1/0)";
  if (value === -Infinity) return "(-1/0)";
  if (Object.is(value, -0)) return "(-0)";
  return "(" + String(value) + ")";
}
export function numericFixtures() {
  const pairs: [number, number][] = [];
  const edge = [
    0,
    -0,
    NaN,
    Infinity,
    -Infinity,
    Number.MIN_VALUE,
    -Number.MIN_VALUE,
    1e-308,
    Number.MAX_VALUE,
    -Number.MAX_VALUE,
    0.5,
    -0.5,
    1,
    -1,
    3,
    -3,
    31,
    32,
    33,
    2 ** 31 - 1,
    2 ** 31,
    2 ** 32 - 1,
    2 ** 32,
    2 ** 32 + 1,
    2 ** 52 - 0.5,
    2 ** 52,
    2 ** 53,
    2 ** 83,
    2 ** 84,
  ];
  for (const x of edge) for (const y of edge) pairs.push([x, y]);
  for (const exponent of [
    -1074, -1022, -1, 0, 30, 31, 32, 51, 52, 53, 63, 83, 84, 1023,
  ]) {
    const x = 2 ** exponent;
    for (const sign of [1, -1])
      for (const y of [0.1, 3, 31.9, -33.9, Number.MIN_VALUE])
        pairs.push([sign * x, y]);
  }
  // Exact power-of-two remainder path, including quotient overflow, signed
  // zero, fractions and the largest normal divisor. Arguments remain dynamic
  // at operation(), so scalar constant folding cannot bypass the leaf helper.
  for (const exponent of [-1022, -1000, -53, -3, 3, 32, 1023]) {
    for (const left of [Number.MAX_VALUE, 2 ** 52 - 0.5, 0x300000018, 0.875]) {
      for (const sign of [1, -1]) {
        pairs.push(
          [sign * left, 2 ** exponent],
          [sign * left, -(2 ** exponent)],
        );
      }
    }
  }
  let seed = 0x6d2b79f5;
  const bytes = new DataView(new ArrayBuffer(8));
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    bytes.setUint32(0, seed);
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    bytes.setUint32(4, seed);
    return bytes.getFloat64(0);
  }
  for (let i = 0; i < 128; i++) pairs.push([random(), random()]);
  // Rounded quotient subtraction fails for these ordinary, overflow and subnormal cases.
  pairs.push(
    [1, 0.1],
    [-4, 2],
    [Number.MAX_VALUE, Number.MIN_VALUE],
    [3 * Number.MIN_VALUE, 2 * Number.MIN_VALUE],
  );
  const fixtures: { name: string; text: string; expected: boolean }[] = [];
  for (const operator of ["%", "&", "|", "^", "<<", ">>", ">>>", "~"]) {
    const oracle = new Function(
      "x",
      "y",
      operator === "~" ? "return ~x" : `return x ${operator} y`,
    );
    for (let start = 0; start < pairs.length; start += 24) {
      const group = pairs.slice(start, start + 24),
        functions = group.map(([x, y], i) => {
          const expected: number = oracle(x, y),
            condition = Number.isNaN(expected)
              ? "r!==r"
              : expected === 0
                ? `r===0 && 1/r===${literal(1 / expected)}`
                : `r===${literal(expected)}`;
          return `function case${i}():boolean {const r=operation(${literal(x)},${literal(y)});return ${condition};}`;
        });
      fixtures.push({
        name: `numeric-${operator
          .split("")
          .map((c) => c.charCodeAt(0).toString(16))
          .join("")}-${start}`,
        text: `export function main():boolean{return ${group.map((_, i) => `case${i}()`).join("&&")};} function operation(x:number,y:number):number{return ${operator === "~" ? "~x" : `x ${operator} y`};} ${functions.join("\n")}`,
        expected: true,
      });
    }
  }
  return { fixtures, cases: pairs.length * 8 };
}
