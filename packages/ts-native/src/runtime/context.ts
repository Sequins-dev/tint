import type { CheckedClosures } from "@tint/typescript/checker";
import type { Type } from "@tint/typescript/types";
import type { CheckedSpecializationRoot } from "../modules/index.ts";
import type { CollectionElement } from "../scalar.ts";
import {
  arrayElement,
  setElement,
  mapEncoding,
} from "../closure/lowering/records.ts";
import {
  createPreparedBindingIndex,
  type PreparedBindingIndex,
} from "./bindings.ts";
import { createElementMatcher, type ElementMatcher } from "./elements.ts";
export interface RuntimeBindingSubject {
  readonly function: string;
  readonly parameter: number;
}
export interface RuntimeCollectionNames {
  readonly kind: "list" | "set" | "map";
  readonly element: CollectionElement | undefined;
  readonly key: CollectionElement | undefined;
  readonly value: CollectionElement | undefined;
  readonly operations: ReadonlyMap<string, string>;
}
export type RuntimeCollectionLookup =
  | { readonly ok: true; readonly value: RuntimeCollectionNames }
  | { readonly ok: false; readonly error: string };
/** Names and observed type IDs are valid only during this transform pass. */
export interface RuntimeBindingContext {
  readonly observed: CheckedClosures;
  collection(subject: RuntimeBindingSubject): RuntimeCollectionLookup;
  primitives(): ReadonlyMap<string, string> | undefined;
  numberText():
    { readonly toString: string; readonly fromString: string } | undefined;
}
import {
  listOperations,
  setOperations,
  mapOperations,
  primitiveOperations,
} from "./operations.ts";
const numberHelpers = [
  "createNumberList",
  "readNumberList",
  "writeNumberList",
  "pushNumberList",
  "lengthNumberList",
  "hasNumberList",
  "deleteNumberList",
  "resizeNumberList",
];
export interface RuntimeBindingRecord {
  readonly subject: RuntimeBindingSubject;
  readonly names: RuntimeCollectionNames;
}
export interface RuntimeBindingControl {
  readonly context: RuntimeBindingContext;
  readonly records: RuntimeBindingRecord[];
  readonly close: () => void;
}
export function createRuntimeBindingContext(input: {
  readonly observed: CheckedClosures;
  readonly types: readonly Type[];
  readonly requests: readonly CheckedSpecializationRoot[];
  readonly roots: readonly string[];
  readonly listStarts: readonly number[];
  readonly setStarts: readonly number[];
  readonly mapStarts: readonly number[];
  readonly helpers: ReadonlyMap<string, string>;
  readonly helper: (namespace: string, name: string) => string;
}): RuntimeBindingControl {
  let closed = false;
  let index: PreparedBindingIndex | undefined;
  let matcher: ElementMatcher | undefined;
  const records: RuntimeBindingRecord[] = [];
  function failure(error: string): RuntimeCollectionLookup {
    return { ok: false, error };
  }
  const helper = input.helper;
  const context: RuntimeBindingContext = {
    observed: input.observed,
    collection(subject: RuntimeBindingSubject): RuntimeCollectionLookup {
      if (closed) return failure("runtime binding context is closed");
      if (index === undefined)
        index = createPreparedBindingIndex(input.observed);
      const observedIndex = index;
      const fn = observedIndex.functionId(subject.function);
      if (fn === undefined)
        return failure(
          "runtime binding subject is not a top-level function: " +
            subject.function,
        );
      const type =
        Number.isInteger(subject.parameter) && subject.parameter >= 0
          ? observedIndex.parameterType(fn, subject.parameter)
          : undefined;
      if (type === undefined)
        return failure(
          "runtime binding subject has no parameter " +
            String(subject.parameter) +
            ": " +
            subject.function,
        );
      const list = arrayElement(input.observed, type),
        set = setElement(input.observed, type),
        map = mapEncoding(input.observed, type);
      if (list === undefined && set === undefined && map === undefined)
        return failure(
          "runtime binding subject is not a collection: " + subject.function,
        );
      if (matcher === undefined) matcher = createElementMatcher(input.types);
      const match = matcher;
      function element(value: CollectionElement): number {
        if (typeof value === "number") return value;
        const id = input.types.findIndex(
          (t) => t !== undefined && t.kind === value,
        );
        if (id < 0) throw "runtime primitive invariant";
        return id;
      }
      const kind =
        list !== undefined ? "list" : set !== undefined ? "set" : "map";
      const operations =
        kind === "list"
          ? listOperations
          : kind === "set"
            ? setOperations
            : mapOperations;
      const starts =
        kind === "list"
          ? input.listStarts
          : kind === "set"
            ? input.setStarts
            : input.mapStarts;
      const start = starts.find((start) => {
        if (start === undefined) return false;
        const args = input.requests[start]?.arguments;
        if (args === undefined) return false;
        const first = args[0],
          second = args[1];
        if (first === undefined) return false;
        if (list !== undefined)
          return match.matches(element(list), first, true);
        if (set !== undefined) return match.matches(element(set), first, false);
        return (
          map !== undefined &&
          second !== undefined &&
          match.matches(element(map.key), first, false) &&
          match.matches(element(map.value), second, false)
        );
      });
      if (!(kind === "list" && list === "number") && start === undefined)
        return failure(
          "runtime binding subject has no " +
            kind +
            " demand: " +
            subject.function,
        );
      const names = new Map<string, string>();
      for (let i = 0; i < operations.length; i++) {
        const operation = operations[i];
        const numberHelper = numberHelpers[i];
        if (
          operation === undefined ||
          (list === "number" && numberHelper === undefined)
        )
          throw "runtime operation invariant";
        const name =
          list === "number"
            ? helper("number-list", numberHelper ?? "")
            : input.roots[(start ?? 0) + i];
        if (name === undefined) throw "runtime root invariant";
        names.set(operation, name);
      }
      const value: RuntimeCollectionNames = {
        kind,
        element: list === undefined ? set : list,
        key: map === undefined ? undefined : map.key,
        value: map === undefined ? undefined : map.value,
        operations: names,
      };
      records.push({
        subject: { function: subject.function, parameter: subject.parameter },
        names: value,
      });
      return { ok: true, value };
    },
    primitives(): ReadonlyMap<string, string> | undefined {
      if (closed) throw "runtime binding context is closed";
      if (!input.helpers.has("primitive-value:fromUndefined")) return undefined;
      const names = new Map<string, string>();

      for (const key of primitiveOperations) {
        if (key === undefined) throw "runtime primitive name invariant";
        names.set(key, helper("primitive-value", key));
      }
      return names;
    },
    numberText():
      { readonly toString: string; readonly fromString: string } | undefined {
      if (closed) throw "runtime binding context is closed";
      return input.helpers.has("number-text:numberToString")
        ? {
            toString: helper("number-text", "numberToString"),
            fromString: helper("number-text", "stringToNumber"),
          }
        : undefined;
    },
  };
  return {
    context,
    records,
    close: (): void => {
      closed = true;
    },
  };
}
