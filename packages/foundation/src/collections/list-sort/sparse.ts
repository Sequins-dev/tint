import { sortIndexed, type IndexedAccess } from "../indexed-sort.ts";
import {
  type SparseList,
  lengthList,
  hasList,
  readList,
  writeList,
  deleteList,
} from "../sparse-list.ts";
export function sortList<T>(
  list: SparseList<T | undefined>,
  compare: (a: T, b: T) => number,
): SparseList<T | undefined> {
  const access: IndexedAccess<T> = {
    length: () => lengthList<T | undefined>(list),
    has: (i) => hasList<T | undefined>(list, i),
    read: (i) => readList<T | undefined>(list, i),
    write: (i, v) => {
      writeList<T | undefined>(list, i, v);
    },
    remove: (i) => {
      deleteList<T | undefined>(list, i);
    },
  };
  sortIndexed<T>(access, compare);
  return list;
}
