// The format-neutral heap graph every heap writer and analysis consumes:
// objects (address, size, type), CSR edges with names and kinds, and root
// frames holding references. Producers decode a runtime's heap into it
// (tools/heap-snapshot/graph.ts for Tint dumps); writers never see the
// producer's dump format.

export const edgeProperty = 0,
  edgeElement = 1,
  edgeInternal = 2,
  edgeWeak = 3;
export type NodeCategory =
  | "record"
  | "string"
  | "vector"
  | "buffer"
  | "weak"
  | "function"
  | "environment"
  | "native";

export interface TypeInfo {
  readonly name: string;
  readonly category: NodeCategory;
}
export interface RootFrame {
  readonly name: string;
  readonly fp: number;
  /** [edge name index, target node] pairs. */
  readonly roots: number[];
}
export interface HeapGraph {
  readonly count: number;
  readonly address: Float64Array;
  readonly size: Uint32Array;
  readonly type: Uint32Array;
  readonly types: readonly TypeInfo[];
  /** CSR edges: node i's edges are [edgeStart[i], edgeStart[i + 1]). */
  readonly edgeStart: Uint32Array;
  readonly edgeTarget: Uint32Array;
  /** An index into `names` (property, internal, weak) or an element index. */
  readonly edgeName: Uint32Array;
  readonly edgeType: Uint8Array;
  readonly names: readonly string[];
  readonly frames: readonly RootFrame[];
  /** A stable, odd snapshot node id for an object. */
  id(object: number): number;
  /** The object's display name when its type name is not enough (string
   * contents), at most `limit` characters. */
  label?(object: number, limit: number): string | undefined;
  /** When the heap was captured (seconds since the epoch). */
  readonly timeSeconds?: number | undefined;
}
