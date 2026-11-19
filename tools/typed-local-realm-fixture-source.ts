export const typedLocalRealmSource = `
interface Entry { count: number; tag?: string }
export function run(): number {
  let order: string = "";
  function key(): string { order = order + "k"; return "first"; }
  function count(): number { order = order + "v"; return 7; }
  const first: Entry = { count: count() };
  const list: Entry[] = [first];
  const alias = list;
  const groups: Record<string, Entry[]> = { [key()]: alias, direct: [{ count: count() }] };
  if (order !== "vkv") return 1;
  const group = groups.first;
  const direct = groups.direct;
  if (group === undefined || group !== list || direct === undefined) return 2;
  if (group.push({ count: 11 }) !== 2 || list.length !== 2) return 3;
  first.tag = "ready";
  const reread = group[0];
  if (reread === undefined || reread !== first || reread.tag !== "ready") return 4;
  alias[1] = { count: 23 };
  if (group[1]?.count !== 23 || direct[0]?.count !== 7 || group[2] !== undefined) return 5;
  function fail(): number { throw new TypeError("abort"); }
  try {
    group.push({ count: fail() });
    return 6;
  } catch (error) {}
  if (group.length !== 2 || groups.first !== group) return 7;
  return 42;
}
`;
