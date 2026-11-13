import type {
  NativeDebugLocation,
  NativeDebugVariable,
  NativeModule,
} from "@tint/codegen/aarch64/scalar";
import type { RecordLayout, ScalarType, Span } from "@tint/ir/scalar";

/** A source position: file (module ID), 1-based line and UTF-16 column. */
export interface SourcePoint {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}
export interface DebugRecordField {
  readonly name: string;
  readonly offset: number;
  readonly type: ScalarType;
}
export interface DebugRecordType {
  readonly name: string;
  readonly byteLength: number;
  readonly fields: readonly DebugRecordField[];
}
/** A value's storage encoding, and the record layout of a reference whose
 * value is statically one record. */
export interface DebugValueType {
  readonly scalar: ScalarType;
  readonly integer: boolean;
  readonly record?: DebugRecordType | undefined;
}
export interface ProgramDebugVariable {
  readonly name: string;
  readonly parameter: boolean;
  readonly declaration?: SourcePoint | undefined;
  readonly type: DebugValueType;
  /** Module-relative code ranges. */
  readonly locations: readonly NativeDebugLocation[];
}
export interface ProgramInlineScope {
  /** The inlined function's display name. */
  readonly origin: string;
  readonly call: SourcePoint;
  /** Module-relative, ordered and disjoint; within the enclosing scope. */
  readonly ranges: readonly { offset: number; byteLength: number }[];
  readonly variables: readonly ProgramDebugVariable[];
  readonly inlined: readonly ProgramInlineScope[];
}
/** Source-level debug facts of one emitted function. */
export interface ProgramFunctionDebug {
  /** Module-relative offset of the function's first instruction. */
  readonly offset: number;
  readonly variables: readonly ProgramDebugVariable[];
  readonly inlined: readonly ProgramInlineScope[];
}

interface Range {
  offset: number;
  byteLength: number;
}
function mergeRanges(ranges: Range[]): Range[] {
  ranges.sort((a, b) => a.offset - b.offset);
  const merged: Range[] = [];
  for (const range of ranges) {
    if (range === undefined) throw "debug range invariant";
    const previous = merged[merged.length - 1];
    if (
      previous !== undefined &&
      range.offset <= previous.offset + previous.byteLength
    ) {
      const end = Math.max(
        previous.offset + previous.byteLength,
        range.offset + range.byteLength,
      );
      previous.byteLength = end - previous.offset;
    } else merged.push({ offset: range.offset, byteLength: range.byteLength });
  }
  return merged;
}
/** Locations restricted to ordered, disjoint scope ranges. */
function within(
  locations: readonly NativeDebugLocation[],
  ranges: readonly Range[],
): NativeDebugLocation[] {
  const result: NativeDebugLocation[] = [];
  for (const location of locations) {
    if (location === undefined) throw "debug location invariant";
    const end = location.offset + location.byteLength;
    for (const range of ranges) {
      if (range === undefined) throw "debug range invariant";
      const from = Math.max(location.offset, range.offset),
        to = Math.min(end, range.offset + range.byteLength);
      if (to > from)
        result.push({
          offset: from,
          byteLength: to - from,
          words: location.words,
        });
    }
  }
  return result;
}
/** Resolve emitted debug metadata to source names, positions and record
 * layouts, and nest inline sites into scopes covering their code. */
export function describeFunctionDebug(
  native: NativeModule,
  records: readonly RecordLayout[],
  resolve: (span: Span) => SourcePoint | undefined,
  displayName: (name: string) => string,
  /** The source name of the binding declared at `span`. */
  variableName: (span: Span, fallback: string) => string,
): ProgramFunctionDebug[] {
  const recordTypes = new Map<number, DebugRecordType>();
  function recordType(id: number): DebugRecordType | undefined {
    const known = recordTypes.get(id);
    if (known !== undefined) return known;
    const layout = records[id],
      names = layout?.debug;
    if (layout === undefined || names === undefined) return undefined;
    const fields: DebugRecordField[] = [];
    for (let index = 0; index < layout.fields.length; index++) {
      const field = layout.fields[index],
        name = names.fields[index];
      if (field === undefined || name === undefined) return undefined;
      fields.push({ name, offset: field.offset, type: field.type });
    }
    const described: DebugRecordType = {
      name: names.name,
      byteLength: layout.byteLength,
      fields,
    };
    recordTypes.set(id, described);
    return described;
  }
  function variable(source: NativeDebugVariable): ProgramDebugVariable {
    const record = source.record;
    return {
      name: variableName({ start: source.start, end: source.end }, source.name),
      parameter: source.parameter,
      declaration: resolve({ start: source.start, end: source.end }),
      type: {
        scalar: source.type,
        integer: source.integer,
        record:
          (source.type === "reference" ||
            source.type === "optional-reference") &&
          record !== undefined
            ? recordType(record)
            : undefined,
      },
      locations: source.locations,
    };
  }
  const result: ProgramFunctionDebug[] = [];
  for (const fn of native.functions) {
    if (fn === undefined) throw "debug function invariant";
    const debug = fn.debug;
    if (fn.import === true || debug === undefined) continue;
    const sites = debug.inlineSites,
      siteRanges: Range[][] = [];
    for (let site = 0; site < sites.length; site++) siteRanges.push([]);
    // Code of a site also belongs to every enclosing site.
    for (const range of debug.inlineRanges) {
      if (range === undefined) throw "debug inline range invariant";
      let site = range.site;
      while (site >= 0) {
        const entry = sites[site],
          list = siteRanges[site];
        if (entry === undefined || list === undefined)
          throw "debug inline site invariant";
        list.push({ offset: range.offset, byteLength: range.byteLength });
        site = entry.parent ?? -1;
      }
    }
    const merged: Range[][] = [];
    for (const list of siteRanges) {
      if (list === undefined) throw "debug inline list invariant";
      merged.push(mergeRanges(list));
    }
    const scopeVariables: ProgramDebugVariable[][] = [],
      children: number[][] = [],
      topLevel: number[] = [],
      own: ProgramDebugVariable[] = [];
    for (let site = 0; site < sites.length; site++) {
      scopeVariables.push([]);
      children.push([]);
    }
    for (let site = 0; site < sites.length; site++) {
      const parent = sites[site]?.parent;
      if (parent === undefined) topLevel.push(site);
      else children[parent]?.push(site);
    }
    for (const source of debug.variables) {
      if (source === undefined) throw "debug variable invariant";
      const inline = source.inline;
      if (inline === undefined) {
        own.push(variable(source));
        continue;
      }
      const ranges = merged[inline];
      if (ranges === undefined || ranges.length === 0) continue;
      const described = variable(source);
      scopeVariables[inline]?.push({
        ...described,
        locations: within(described.locations, ranges),
      });
    }
    function scope(site: number): ProgramInlineScope | undefined {
      const entry = sites[site],
        ranges = merged[site];
      if (entry === undefined || ranges === undefined || ranges.length === 0)
        return undefined;
      const call = resolve({ start: entry.start, end: entry.end });
      if (call === undefined) return undefined;
      const inlined: ProgramInlineScope[] = [];
      for (const child of children[site] ?? []) {
        if (child === undefined) throw "debug inline child invariant";
        const nested = scope(child);
        if (nested !== undefined) inlined.push(nested);
      }
      return {
        origin: displayName(entry.callee),
        call,
        ranges,
        variables: scopeVariables[site] ?? [],
        inlined,
      };
    }
    const inlined: ProgramInlineScope[] = [];
    for (const site of topLevel) {
      if (site === undefined) throw "debug inline site invariant";
      const described = scope(site);
      if (described !== undefined) inlined.push(described);
    }
    result.push({ offset: fn.offset, variables: own, inlined });
  }
  return result;
}
