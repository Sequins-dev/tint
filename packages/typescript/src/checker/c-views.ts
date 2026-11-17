/** C views (docs/native-ffi.md, "C views"): property syntax over memory
 * described by a C binding's record interfaces.
 *
 * A view is a Uint8Array whose first bytes hold one C record (or fixed
 * array), typed nominally as `{ kind: "Uint8Array", view: key }`. Ordinary
 * byte arrays and objects never relate to a view; a view relates to
 * Uint8Array, so it passes wherever bytes are expected (a `Ptr<R>`
 * argument). The binding layer computes every shape from the shared C
 * layout and hands the checker a registry keyed by linked names; the
 * checker records each view operation for the lowering, which compiles a
 * member access to one constant-offset load or store. */

/** One member of a record view, or the element of an array view. */
export interface CViewMember {
  readonly name: string;
  /** Byte offset in the record (0 for an array element). */
  readonly offset: number;
  /** Bytes the member occupies (an array element's stride). */
  readonly size: number;
  /** `number` and `boolean` members are scalars or raw addresses of C type
   * `scalar`; `view` members are nested records or arrays (`view` key). */
  readonly value: "number" | "boolean" | "view";
  /** The C scalar name (`u32`, `f64`, `bool`, ...) or `pointer`; empty for
   * nested views. A write to an integer or address member must convert
   * exactly (an integer in range), else TypeError; floats and booleans take
   * every value of their type (f32 rounds). */
  readonly scalar: string;
  /** The nested view's key; empty for scalars. */
  readonly view: string;
}
/** A record view (`members`) or a fixed array view (`element`, `length`). */
export interface CViewShape {
  /** Bytes the view needs: creating one checks the array holds them. */
  readonly size: number;
  readonly members: readonly CViewMember[];
  readonly element?: CViewMember | undefined;
  /** Array views: the element count (0 for records). */
  readonly length: number;
}
/** What the checker needs to recognize views in a linked module. */
export interface CViewRegistry {
  /** Linked type name of `tint:ffi`'s `View` alias (`View<R>`); empty when
   * the program does not link `tint:ffi`. */
  readonly viewType: string;
  /** Linked type names of binding record interfaces, to their view keys. */
  readonly records: ReadonlyMap<string, string>;
  /** Linked value names of binding Layout constants (`R.view(bytes)`), to
   * their view keys. */
  readonly layouts: ReadonlyMap<string, string>;
  /** Linked value names of `tint:ffi/unsafe`'s `viewAt` (`view`) and
   * `arrayAt` (`array`): calls whose first argument is a Layout constant
   * return views of that record (one, or an array of them) over memory C
   * owns. */
  readonly foreign: ReadonlyMap<string, "view" | "array">;
  /** Every view shape by key (records and the arrays they contain). */
  readonly shapes: ReadonlyMap<string, CViewShape>;
}
/** One checked view operation, keyed by its expression:
 * - `new`: `R.view(bytes)` (the call), creating a view of `view`;
 * - `member`: a member read or write target `v.m` of view `view`;
 * - `element`: an element read or write target `v[i]` of array view `view`
 *   (`member` is its element; the index must be an integer in range, else
 *   RangeError);
 * - `length`: `v.length` of array view `view` (its constant length). */
export interface CViewUse {
  readonly kind: "new" | "member" | "element" | "length";
  readonly view: string;
  /** The view's byte size and (array views) element count. */
  readonly size: number;
  readonly length: number;
  readonly member?: CViewMember | undefined;
}
/** Member `name` of record view `shape`, if declared. */
export function cViewMember(
  shape: CViewShape,
  name: string,
): CViewMember | undefined {
  for (const member of shape.members) {
    if (member === undefined) throw "C view member invariant";
    if (member.name === name) return member;
  }
  return undefined;
}
