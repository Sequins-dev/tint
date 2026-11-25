// Imported only by the Worker entry: it evaluates in that Worker's isolate
// alone, so its line prints once (main never evaluates it).
export const tally: number[] = [];
console.log("worker-typed-entry: Worker-only module evaluated");
export function record(value: number): number {
  tally.push(value);
  return tally.length;
}
