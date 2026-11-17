import {
  cLayout,
  type CLibraryDeclaration,
  type CTarget,
  type CType,
} from "@tint/abi/c";
import type { CViewMember, CViewShape } from "@tint/typescript/checker";
/** One C view shape of a binding (docs/native-ffi.md, "C views"): a
 * declared record (`record` names it) or a fixed array member inside one. */
export interface ForeignView {
  readonly key: string;
  readonly record: string | undefined;
  readonly shape: CViewShape;
}
export type ForeignViewsResult =
  | { readonly ok: true; readonly value: readonly ForeignView[] }
  | { readonly ok: false; readonly error: string };
/** The view key of record `name` of binding module `module`. */
export function foreignViewKey(module: string, name: string): string {
  return module + "#" + name;
}
/** The view shapes of every record a binding declares, from the same
 * layout computation the C calls and descriptors use. */
export function foreignViews(
  library: CLibraryDeclaration,
  target: CTarget,
): ForeignViewsResult {
  const views: ForeignView[] = [];
  let failure: string | undefined;
  function member(
    type: CType,
    name: string,
    offset: number,
    key: string,
  ): CViewMember | undefined {
    const layout = cLayout(type, target);
    if (!layout.ok) {
      failure = key + ": " + layout.error;
      return undefined;
    }
    const size = layout.value.size;
    if (type.kind === "scalar" || type.kind === "pointer")
      return {
        name,
        offset,
        size,
        value:
          type.kind === "scalar" && type.scalar === "bool"
            ? "boolean"
            : "number",
        scalar: type.kind === "scalar" ? type.scalar : "pointer",
        view: "",
      };
    if (type.kind === "record")
      return {
        name,
        offset,
        size,
        value: "view",
        scalar: "",
        view: foreignViewKey(library.module, type.name),
      };
    if (type.kind === "array") {
      const element = member(type.element, "", 0, key + "[]");
      if (element === undefined) return undefined;
      views.push({
        key,
        record: undefined,
        shape: { size, members: [], element, length: type.length },
      });
      return {
        name,
        offset,
        size,
        value: "view",
        scalar: "",
        view: key,
      };
    }
    failure = key + ": unsupported C view member";
    return undefined;
  }
  for (const record of library.records) {
    if (record === undefined) throw "foreign view record invariant";
    const type = record.type;
    if (type.kind !== "record") throw "foreign view record kind invariant";
    const key = foreignViewKey(library.module, record.name),
      layout = cLayout(type, target);
    if (!layout.ok)
      return { ok: false, error: record.name + ": " + layout.error };
    const members: CViewMember[] = [];
    for (let index = 0; index < type.fields.length; index++) {
      const field = type.fields[index],
        offset = layout.value.offsets[index];
      if (field === undefined || offset === undefined)
        throw "foreign view field invariant";
      const resolved = member(
        field.type,
        field.name,
        offset,
        key + "." + field.name,
      );
      if (resolved === undefined)
        return { ok: false, error: failure ?? "foreign view invariant" };
      members.push(resolved);
    }
    views.push({
      key,
      record: record.name,
      shape: { size: layout.value.size, members, length: 0 },
    });
  }
  return { ok: true, value: views };
}
