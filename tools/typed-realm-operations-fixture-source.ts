export const typedRealmOperations = `
function frameMap(frameBytes: number, references: number[], generals: number[]): number[] {
  return [frameBytes, references.length, ...references, generals.length, ...generals, 0];
}
export function run(): number {
  let order: string = "";
  function observed(): string { return order; }
  const counts: { total: number; [key: string]: number } = { total: 5 };
  function receiver(): { total: number; [key: string]: number } { order += "r"; return counts; }
  function key(): "total" { order += "k"; return "total"; }
  function value(): number { order += "v"; return 8; }
  if ((receiver()[key()] += value()) !== 13 || observed() !== "rkv") return 1;
  if (receiver()[key()]++ !== 13 || ++receiver()[key()] !== 15 || observed() !== "rkvrkrk") return 2;
  if ((counts.pending ??= value()) !== 8 || (counts.pending ||= value()) !== 8 || observed() !== "rkvrkrkv") return 3;
  if ((counts.total &&= value()) !== 8 || observed() !== "rkvrkrkvv") return 4;
  const groups: Record<string, number[]> = { data: [1, 3, 5] };
  const items = groups.data;
  if (items === undefined) return 5;
  if (items.unshift(9) !== 4 || items.pop() !== 5 || items.shift() !== 9) return 6;
  if (items.fill(7, 1) !== items || items.join(":") !== "1:7") return 7;
  const copy = items.slice();
  if (copy === items || copy.at(-1) !== 7 || !copy.includes(1)) return 8;
  const removed = copy.splice(0, 1, 6, 8);
  if (removed[0] !== 1 || copy.join() !== "6,8,7" || items.join() !== "1,7") return 9;
  const map = frameMap(32, [3, 5], [2, 4, 6]);
  if (map.length !== 9 || map[0] !== 32 || map[3] !== 5 ||
      map[4] !== 3 || map[7] !== 6 || map[8] !== 0) return 10;
  const holes: number[] = [8];
  holes.length = 3;
  const spread = [0, ...holes, 34];
  if (spread.length !== 5 || spread[1] !== 8 || !(2 in spread) || spread[2] !== undefined || spread[4] !== 34) return 11;
  return 42;
}
`;

export const typedRealmAggregateFlow = `
function identity(value: number[]): number[] { return value; }
function addOne(values: number[]): void { values.push(1); }
export function run(): number {
  const native: number[] = [39];
  const alternative = [2];
  const holder: { values: number[] } = { values: native };
  const selected = native.length > 0 ? identity(holder.values) : alternative;
  const groups: Record<string, number[]> = { group: selected };
  const captured = (): void => { selected.push(1); };
  captured();
  addOne(holder.values);
  const alias = groups.group;
  if (alias !== native || alias === undefined || holder.values !== alias) return 1;
  return (alias[0] ?? 0) + (alias[1] ?? 0) + (alias[2] ?? 0) + alias.length - 2;
}
`;

export const typedVoidCallbackResults = `
function capture(cb: () => void): unknown {
  const value: unknown = cb();
  return value;
}
function forward(cb: () => void): void { return cb(); }
function absent(): void {}
function report(cb: () => void): boolean { return cb() === undefined; }
export function run(): number {
  let count: number = 0;
  function calls(): number { return count; }
  const cb = (): number => ++count;
  if (capture(cb) !== 1 || report(cb)) return 1;
  const direct: unknown = forward(cb);
  if (direct !== 3 || calls() !== 3) return 2;
  if (!report(absent) || capture(absent) !== undefined) return 3;
  if (capture(() => "value") !== "value" || capture(() => true) !== true) return 4;
  const alias: () => void = () => 42;
  const values = [alias()];
  const stored: unknown = values[0];
  if (stored !== 42) return 5;
  forward(cb);
  if (calls() !== 4) return 6;
  return 42;
}
`;
