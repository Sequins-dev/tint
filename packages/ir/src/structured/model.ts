/** Structured IR (see docs/progressive-lowering.md): one op/region model for
 * every level above the scalar IR. An op has a kind, SSA operands and
 * results, attributes and nested regions; a region is a list of blocks whose
 * arguments are SSA values. A dialect is the set of kinds legal at a level.
 * Ops are mutable so patterns can rewrite in place; values are numbered by
 * their graph. */
export interface Op {
  readonly kind: string;
  operands: number[];
  results: number[];
  /** Numeric attributes (constants, record/field ids, proven facts). */
  readonly numbers: Map<string, number>;
  /** String attributes (operators, names, tags). */
  readonly strings: Map<string, string>;
  regions: Region[];
  readonly start: number;
  readonly end: number;
}
export interface Block {
  arguments: number[];
  ops: Op[];
}
export interface Region {
  blocks: Block[];
}
/** Value table: each value id's type (a scalar type or a dialect type). */
export interface Graph {
  readonly types: string[];
}
export function createGraph(): Graph {
  return { types: [] };
}
export function newValue(graph: Graph, type: string): number {
  graph.types.push(type);
  return graph.types.length - 1;
}
export function valueType(graph: Graph, value: number): string {
  const type = graph.types[value];
  if (type === undefined) throw "STRUCTURED_UNKNOWN_VALUE";
  return type;
}
export interface OpInit {
  readonly operands?: readonly number[];
  readonly results?: readonly number[];
  readonly regions?: readonly Region[];
  readonly start?: number;
  readonly end?: number;
}
export function createOp(kind: string, init: OpInit): Op {
  return {
    kind,
    operands: (init.operands ?? []).slice(),
    results: (init.results ?? []).slice(),
    numbers: new Map<string, number>(),
    strings: new Map<string, string>(),
    regions: (init.regions ?? []).slice(),
    start: init.start ?? 0,
    end: init.end ?? 0,
  };
}
export function createRegion(blocks: readonly Block[]): Region {
  return { blocks: blocks.slice() };
}
export function createBlock(
  argumentsList: readonly number[],
  ops: readonly Op[],
): Block {
  return { arguments: argumentsList.slice(), ops: ops.slice() };
}
/** The single block of a single-block region (structured bodies). */
export function onlyBlock(region: Region): Block {
  const block = region.blocks[0];
  if (block === undefined || region.blocks.length !== 1)
    throw "STRUCTURED_REGION_SHAPE";
  return block;
}
export function numberAttribute(op: Op, name: string): number {
  const value = op.numbers.get(name);
  if (value === undefined) throw "STRUCTURED_MISSING_ATTRIBUTE";
  return value;
}
export function stringAttribute(op: Op, name: string): string {
  const value = op.strings.get(name);
  if (value === undefined) throw "STRUCTURED_MISSING_ATTRIBUTE";
  return value;
}
