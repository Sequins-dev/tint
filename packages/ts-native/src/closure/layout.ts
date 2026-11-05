import type { BoundModule } from "@tint/typescript/binding";
import {
  createLayoutPlanner,
  type Storage,
  type Field,
  type RecordLayout,
  type ObjectLayout,
  type TargetDataLayout,
} from "@tint/foundation/layout";
export interface BindingStorage extends Storage {
  readonly binding: number;
}
export interface CellLayout {
  readonly binding: number;
  readonly stateOffset: number;
  readonly valueOffset: number;
  readonly storage: Storage;
  readonly mutable: boolean;
  readonly initialize: "parameter" | "function" | "declaration";
}
export interface EnvironmentLayout {
  readonly scope: number;
  readonly lifetime: "activation" | "block-entry" | "loop-entry";
  readonly layout: RecordLayout;
  readonly object: ObjectLayout;
  readonly cells: readonly CellLayout[];
  readonly iterationCopies: readonly number[];
}
export interface EnvironmentPointer {
  readonly scope: number;
  readonly pointerOffset: number;
}
export interface CaptureAddress {
  readonly binding: number;
  readonly environment: number;
  readonly pointerOffset: number;
  readonly stateOffset: number;
  readonly valueOffset: number;
}
export interface FunctionLayout {
  readonly function: number;
  readonly layout: RecordLayout;
  readonly environments: readonly EnvironmentPointer[];
  readonly captures: readonly CaptureAddress[];
}
export interface ClosureLayouts {
  readonly environments: readonly EnvironmentLayout[];
  readonly functions: readonly FunctionLayout[];
}
export type Result =
  | { readonly ok: true; readonly value: ClosureLayouts }
  | {
      readonly ok: false;
      readonly error:
        | "INVALID_TARGET"
        | "INVALID_STORAGE"
        | "DUPLICATE_FIELD"
        | "LIMIT"
        | "INVALID_REPRESENTATIONS";
    };
/** Plan storage for a successful binder graph. This does not choose types or allocate objects. */
export function planClosures(
  graph: BoundModule,
  representations: readonly BindingStorage[],
  target: TargetDataLayout,
  maxBytes: number,
): Result {
  const planner = createLayoutPlanner(target, maxBytes);
  if (!planner.ok) return planner;
  const storage = new Map<number, Storage>();
  for (const r of representations) {
    if (r === undefined) return { ok: false, error: "INVALID_REPRESENTATIONS" };
    const b = graph.bindings[r.binding];
    if (
      b === undefined ||
      b.id !== r.binding ||
      !b.captured ||
      storage.has(r.binding)
    )
      return { ok: false, error: "INVALID_REPRESENTATIONS" };
    storage.set(r.binding, { size: r.size, alignment: r.alignment });
  }
  for (const b of graph.bindings) {
    if (b === undefined) throw "binding graph invariant";
    if (b.captured && !storage.has(b.id))
      return { ok: false, error: "INVALID_REPRESENTATIONS" };
  }
  const environments: EnvironmentLayout[] = [],
    functions: FunctionLayout[] = [];
  const cells = new Map<number, CellLayout>();
  for (const scope of graph.scopes) {
    if (scope === undefined) throw "scope graph invariant";
    const owned = graph.bindings.filter(
      (b) => b.scope === scope.id && b.captured,
    );
    if (owned.length === 0) continue;
    const fields: Field[] = [];
    for (const b of owned) {
      if (b === undefined) throw "owned binding invariant";
      const s = storage.get(b.id);
      if (s === undefined) throw "representation invariant";
      fields.push(
        { id: "state:" + b.id, size: 1, alignment: 1 },
        { id: "value:" + b.id, size: s.size, alignment: s.alignment },
      );
    }
    const layout = planner.value.record(fields);
    if (!layout.ok) return layout;
    const object = planner.value.object(layout.value);
    if (!object.ok) return object;
    const placed: CellLayout[] = [];
    for (let i = 0; i < owned.length; i++) {
      const b = owned[i],
        state = layout.value.fields[i * 2],
        value = layout.value.fields[i * 2 + 1];
      if (b === undefined || state === undefined || value === undefined)
        throw "cell layout invariant";
      const cell = {
        binding: b.id,
        stateOffset: state.offset,
        valueOffset: value.offset,
        storage: { size: value.size, alignment: value.alignment },
        mutable: b.mutable,
        initialize:
          b.kind === "parameter"
            ? "parameter"
            : b.kind === "function"
              ? "function"
              : "declaration",
      } satisfies CellLayout;
      placed.push(cell);
      cells.set(b.id, cell);
    }
    environments.push({
      scope: scope.id,
      lifetime:
        scope.kind === "function"
          ? "activation"
          : scope.kind === "for"
            ? "loop-entry"
            : "block-entry",
      layout: layout.value,
      object: object.value,
      cells: placed,
      iterationCopies:
        scope.kind === "for"
          ? owned.filter((b) => b.kind === "let").map((b) => b.id)
          : [],
    });
  }
  for (const fn of graph.functions) {
    if (fn === undefined) throw "function graph invariant";
    const scopes = new Set<number>();
    for (const c of fn.captures) {
      if (c === undefined) throw "capture graph invariant";
      const b = graph.bindings[c.binding];
      if (b === undefined) throw "capture binding invariant";
      scopes.add(b.scope);
    }
    const ids = [...scopes].sort((a, b) => a - b);
    const layout = planner.value.record(
      ids.map((id) => ({
        id: "scope:" + id,
        size: target.pointerSize,
        alignment: target.pointerSize,
      })),
    );
    if (!layout.ok) return layout;
    const pointers: EnvironmentPointer[] = [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i],
        field = layout.value.fields[i];
      if (id === undefined || field === undefined)
        throw "environment pointer invariant";
      pointers.push({ scope: id, pointerOffset: field.offset });
    }
    const captures: CaptureAddress[] = [];
    for (const c of fn.captures) {
      if (c === undefined) throw "capture graph invariant";
      const b = graph.bindings[c.binding],
        cell = cells.get(c.binding);
      if (b === undefined || cell === undefined) throw "capture cell invariant";
      const pointer = pointers.find(
        (p) => p !== undefined && p.scope === b.scope,
      );
      if (pointer === undefined) throw "capture pointer invariant";
      captures.push({
        binding: c.binding,
        environment: b.scope,
        pointerOffset: pointer.pointerOffset,
        stateOffset: cell.stateOffset,
        valueOffset: cell.valueOffset,
      });
    }
    functions.push({
      function: fn.id,
      layout: layout.value,
      environments: pointers,
      captures,
    });
  }
  return { ok: true, value: { environments, functions } };
}
export type { TargetDataLayout } from "@tint/foundation/layout";
