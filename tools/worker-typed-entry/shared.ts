// Shared by the main entry and the typed Worker entry. Each isolate gets its
// own module instance, so `bump` counts per isolate (as in Node).
export const table: number[] = [1, 2, 3];
export function bump(): number {
  table.push(table.length);
  return table.length;
}
export function square(value: number): number {
  return value * value;
}
