export interface CatalogEntry<T> {
  readonly id: string;
  readonly value: T;
}
export type Lookup<T> =
  { readonly found: true; readonly value: T } | { readonly found: false };
export interface Catalog<T> {
  readonly size: number;
  readonly ids: () => readonly string[];
  readonly lookup: (id: string) => Lookup<T>;
}
export type CatalogResult<T> =
  | { readonly ok: true; readonly value: Catalog<T> }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: "INVALID_ID" | "DUPLICATE_ID" | "CASE_COLLISION";
        readonly id: string;
        readonly otherId: string | undefined;
      };
    };

export function isModuleId(id: string): boolean {
  if (id.length === 0) return false;
  let start = 0;
  for (let i = 0; i <= id.length; i++) {
    if (i === id.length || id.charCodeAt(i) === 47) {
      const part = id.slice(start, i);
      if (part === "" || part === "." || part === "..") return false;
      start = i + 1;
    } else {
      const c = id.charCodeAt(i);
      if (!(
        (c >= 65 && c <= 90) ||
        (c >= 97 && c <= 122) ||
        (c >= 48 && c <= 57) ||
        c === 45 ||
        c === 46 ||
        c === 95
      ))
        return false;
    }
  }
  return true;
}
/** IDs have already been restricted to ASCII by isModuleId. */
function foldId(id: string): string {
  let folded = "";
  for (let index = 0; index < id.length; index++) {
    const unit = id.charCodeAt(index);
    folded += String.fromCharCode(unit >= 65 && unit <= 90 ? unit + 32 : unit);
  }
  return folded;
}
export function createCatalog<T>(
  entries: readonly CatalogEntry<T>[],
): CatalogResult<T> {
  const values = new Map<string, Lookup<T>>(),
    folded = new Map<string, string>(),
    ids: string[] = [];
  for (const entry of entries) {
    if (entry === undefined) throw "catalog entry invariant";
    if (!isModuleId(entry.id))
      return {
        ok: false,
        error: { code: "INVALID_ID", id: entry.id, otherId: undefined },
      };
    const other = folded.get(foldId(entry.id));
    if (other !== undefined)
      return {
        ok: false,
        error: {
          code: other === entry.id ? "DUPLICATE_ID" : "CASE_COLLISION",
          id: entry.id,
          otherId: other,
        },
      };
    folded.set(foldId(entry.id), entry.id);
    values.set(entry.id, { found: true, value: entry.value });
    ids.push(entry.id);
  }
  ids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    ok: true,
    value: {
      size: ids.length,
      ids: () => ids.slice(),
      lookup: (id) => {
        const entry = values.get(id);
        if (entry === undefined || !entry.found) return { found: false };
        return { found: true, value: entry.value };
      },
    },
  };
}
