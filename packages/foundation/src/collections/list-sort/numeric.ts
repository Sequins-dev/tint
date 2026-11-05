import { sortIndexed, type IndexedAccess } from "../indexed-sort.ts";
import {
  type NumberList,
  lengthNumberList,
  hasNumberList,
  readNumberList,
  writeNumberList,
  deleteNumberList,
} from "../number-list.ts";
export function sortNumberList(
  list: NumberList,
  compare: (a: number, b: number) => number,
): NumberList {
  const access: IndexedAccess<number> = {
    length: () => lengthNumberList(list),
    has: (i) => hasNumberList(list, i),
    read: (i) => readNumberList(list, i),
    write: (i, v) => {
      writeNumberList(list, i, v);
    },
    remove: (i) => {
      deleteNumberList(list, i);
    },
  };
  sortIndexed<number>(access, compare);
  return list;
}
