export const typedDynamicObjectSource = `
export function run(): number {
  let order: string = "";
  function key(text: string): string { order = order + "k"; return text; }
  function val(n: number): number { order = order + "v"; return n; }
  function observed(): string { return order; }
  function read(object: Record<string, number>, key: string): number | undefined {
    return object[key];
  }
  const value: Record<string, number> = { [key("first")]: val(7), [key("first")]: val(11) };
  if (observed() !== "kvkv" || read(value, "first") !== 11) return 1;
  const name: string = "first";
  if (value[name] !== 11 || value.missing !== undefined) return 2;
  const assigned: number = (value[key("first")] = val(13));
  if (observed() !== "kvkvkv" || assigned !== 13 || read(value, "first") !== 13) return 3;
  value[2] = 5;
  if (value["2"] !== 5) return 4;
  if (!(name in value) || "absent" in value) return 5;
  if (!delete value[name] || name in value || !delete value[name]) return 6;
  const parent: Record<string, unknown> = { inherited: 19 };
  const child: Record<string, unknown> = { __proto__: parent };
  if (!("inherited" in child) || child.inherited !== 19) return 7;
  const empty: Record<string, unknown> = { __proto__: null };
  if ("toString" in empty) return 8;
  const computed: Record<string, number> = { [key("__proto__")]: 23 };
  if (computed["__proto__"] !== 23 || !("toString" in computed)) return 9;
  const __proto__: number = 29;
  const shorthand: Record<string, number> = { __proto__ };
  if (shorthand["__proto__"] !== 29 || !("toString" in shorthand)) return 10;
  const nested: Record<string, Record<string, number>> = { child: value };
  const inner = nested.child;
  if (inner === undefined || inner !== value) return 11;
  inner[2] = 31;
  if (read(value, "2") !== 31) return 12;
  const big: Record<string, bigint> = { answer: 9007199254740993n };
  const exact = big.answer;
  if (exact === undefined || exact !== 9007199254740993n) return 13;
  const ordered: Record<string, number> = { z: 1, 10: 2, 2: 3, "01": 4, "4294967295": 5, "4294967294": 6 };
  let keys: string = "";
  for (const field in ordered) keys += field + ":";
  if (keys !== "2:10:4294967294:z:01:4294967295:") return 14;
  function joined(object: Record<string, number>): string {
    let result: string = "";
    let field: string = "";
    for (field in object) result += field + ":";
    return result;
  }
  delete ordered.z;
  ordered.z = 9;
  if (joined(ordered) !== "2:10:4294967294:01:4294967295:z:") return 15;
  const ancestor: Record<string, unknown> = { x: 1, shadow: 2 };
  const descendant: Record<string, unknown> = { __proto__: ancestor, shadow: 3 };
  let inherited: string = "";
  for (const field in descendant) inherited += field + ":";
  if (inherited !== "shadow:x:") return 16;
  const copied: Record<string, number> = { first: 1, ...ordered, last: 2 };
  if (joined(copied) !== "2:10:4294967294:first:01:4294967295:z:last:") return 17;
  function explode(): Record<string, number> { throw new TypeError("spread"); }
  const before = observed();
  try {
    const unused: Record<string, number> = { ...ordered, ...explode(), late: val(1) };
    return 18;
  } catch (error) {}
  if (observed() !== before) return 18;
  const ownKeys = Object.keys(copied);
  if (ownKeys.length !== 8 || ownKeys[0] !== "2" || ownKeys[7] !== "last") return 19;
  const values = Object.values(copied);
  if (values[0] !== 3 || values[7] !== 2) return 20;
  const entries: [string, number][] = Object.entries(copied);
  const entry = entries[1];
  if (entry === undefined || entry[0] !== "10" || entry[1] !== 2) return 21;
  function finite(key: "a" | "b"): number {
    const pair: Record<"a" | "b", number> = { a: 7, b: 13 };
    pair[key] = 42;
    return pair[key];
  }
  if (finite("a") !== 42 || finite("b") !== 42) return 22;
  return 42;
}`;
