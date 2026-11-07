export {
  runtimeFunctionIds,
  visitRuntimeFunctions,
  type RuntimeFunctionKind,
  type RuntimeFunctionVisitor,
} from "./function-ids.ts";
import {
  createRuntimeBindingContext,
  type RuntimeBindingContext,
  type RuntimeBindingSubject,
} from "./context.ts";
import {
  arrayElement,
  setElement,
  mapEncoding,
} from "../closure/lowering/records.ts";
export type {
  RuntimeBindingContext,
  RuntimeBindingSubject,
  RuntimeCollectionNames,
  RuntimeCollectionLookup,
} from "./context.ts";
import { createElementMatcher } from "./elements.ts";
import { createPreparedBindingIndex } from "./bindings.ts";
import {
  collectRuntimeRequirements,
  type ModuleEntryOptions,
} from "../closure/lowering/index.ts";
import {
  checkClosureModule,
  type CheckedClosures,
} from "@tint/typescript/checker";
import {
  specializeCheckedRoots,
  type CheckedSpecializationRoot,
} from "../modules/index.ts";
import { type Type } from "@tint/typescript/types";
import { rewriteModule, type Module } from "@tint/typescript/syntax";
import type {
  ListRuntime,
  SetRuntime,
  MapRuntime,
  ListRuntimeBinding,
  SetRuntimeBinding,
  MapRuntimeBinding,
  CollectionElement,
  PrimitiveRuntime,
} from "../scalar.ts";
interface PreparedCollectionRuntime {
  readonly checked: CheckedClosures;
  readonly options: ModuleEntryOptions;
}
export type RuntimePreparation =
  | {
      readonly ok: true;
      readonly value: PreparedCollectionRuntime;
    }
  | { readonly ok: false; readonly error: string };
export type RuntimeModuleTransform = (
  module: Module,
  context: RuntimeBindingContext,
) =>
  | { readonly ok: true; readonly value: Module }
  | { readonly ok: false; readonly error: string };
/** Templates are linked alongside the source; helpers maps namespace:export to its linked name. */
export function prepareCollectionRuntimes(
  module: Module,
  checked: CheckedClosures,
  helpers: ReadonlyMap<string, string>,
  globals: readonly string[],
  transform?: RuntimeModuleTransform,
  maxSpecializations: number = 8192,
): RuntimePreparation {
  let observed = checked;
  const consulted: RuntimeBindingSubject[] = [];
  while (true) {
    const result = prepareCollectionPass(
      module,
      observed,
      helpers,
      globals,
      transform,
      maxSpecializations,
      consulted,
    );
    if (result.ok || result.retry === undefined) return result;
    const next = result.retry;
    const before = collectRuntimeRequirements(observed),
      after = collectRuntimeRequirements(next);
    const previousCount =
        before.lists.length +
        before.sets.length +
        before.maps.length +
        before.sorts.length,
      nextCount =
        after.lists.length +
        after.sets.length +
        after.maps.length +
        after.sorts.length;
    // Every retry must discover another contract. The existing specialization
    // budget bounds expanding helper graphs; a stalled graph is an error.
    if (nextCount <= previousCount)
      return {
        ok: false,
        error: "runtime requirements did not converge: " + result.error,
      };
    observed = next;
  }
}
type CollectionPass =
  | { readonly ok: true; readonly value: PreparedCollectionRuntime }
  | {
      readonly ok: false;
      readonly error: string;
      readonly retry?: CheckedClosures | undefined;
    };
function prepareCollectionPass(
  module: Module,
  checked: CheckedClosures,
  helpers: ReadonlyMap<string, string>,
  globals: readonly string[],
  transform: RuntimeModuleTransform | undefined,
  maxSpecializations: number,
  consulted: RuntimeBindingSubject[],
): CollectionPass {
  let retry: CheckedClosures | undefined = undefined;
  const demand = collectRuntimeRequirements(checked);
  const unsupported = demand.unsupported[0];
  if (unsupported !== undefined)
    return {
      ok: false,
      error:
        "unsupported " +
        unsupported.kind +
        " runtime element at type " +
        String(unsupported.type),
    };
  const abort = {};
  let error = "";
  function fail(message: string): never {
    error = message;
    throw abort;
  }
  function helper(namespace: string, name: string): string {
    const found = helpers.get(namespace + ":" + name);
    if (found === undefined)
      fail("missing runtime helper: " + namespace + ":" + name);
    return found;
  }
  try {
    const types: Type[] = checked.types.slice();
    function primitive(name: "number" | "string" | "undefined"): number {
      const found = types.findIndex((t) => t !== undefined && t.kind === name);
      if (found >= 0) return found;
      const id = types.length;
      types.push({ kind: name });
      return id;
    }
    function elementType(element: CollectionElement): number {
      return typeof element === "number" ? element : primitive(element);
    }
    function optional(id: number): number {
      const absent = primitive("undefined"),
        output = types.length;
      types.push({ kind: "union", members: [id, absent] });
      return output;
    }
    const requests: CheckedSpecializationRoot[] = [];
    const listStarts: number[] = [],
      setStarts: number[] = [],
      mapStarts: number[] = [],
      sortStarts: number[] = [];
    function request(
      namespace: string,
      names: readonly string[],
      args: readonly number[],
    ): number {
      const start = requests.length;
      for (const name of names) {
        if (name === undefined) throw "runtime helper name invariant";
        requests.push({ name: helper(namespace, name), arguments: args });
      }
      return start;
    }
    const listNames = [
      "createList",
      "readList",
      "writeList",
      "pushList",
      "lengthList",
      "hasList",
      "deleteList",
      "resizeList",
    ];
    const setNames = [
      "createSet",
      "hasSet",
      "addSet",
      "deleteSet",
      "clearSet",
      "sizeSet",
      "createSetCursor",
      "advanceSetCursor",
      "readSetCursor",
      "cloneSet",
    ];
    const mapNames = [
      "createMap",
      "getMap",
      "hasMap",
      "setMap",
      "deleteMap",
      "clearMap",
      "sizeMap",
      "createMapCursor",
      "advanceMapCursor",
      "readMapCursorKey",
      "readMapCursorValue",
    ];
    for (const list of demand.lists) {
      if (list === undefined) throw "list demand invariant";
      if (list.element !== "number")
        listStarts.push(
          request("sparse-list", listNames, [
            optional(elementType(list.element)),
          ]),
        );
    }
    for (const set of demand.sets) {
      if (set === undefined) throw "set demand invariant";
      setStarts.push(
        request("linked-set", setNames, [elementType(set.element)]),
      );
    }
    for (const map of demand.maps) {
      if (map === undefined) throw "map demand invariant";
      mapStarts.push(
        request("linked-map", mapNames, [
          elementType(map.key),
          elementType(map.value),
        ]),
      );
    }
    for (const sort of demand.sorts) {
      if (sort === undefined) throw "sort demand invariant";
      if (sort.element !== "number")
        sortStarts.push(
          request("list-sort", ["sortList"], [elementType(sort.element)]),
        );
    }
    const specialized = specializeCheckedRoots(
      module,
      types,
      requests,
      globals,
      maxSpecializations,
    );
    if (!specialized.ok) return { ok: false, error: specialized.error.message };
    const specializedValue = specialized.value;
    const control =
      transform === undefined
        ? undefined
        : createRuntimeBindingContext({
            observed: checked,
            types,
            requests,
            roots: specializedValue.roots,
            listStarts,
            setStarts,
            mapStarts,
            helpers,
            helper,
          });
    const transformed = (():
      | { readonly ok: true; readonly value: Module }
      | { readonly ok: false; readonly error: string } => {
      if (transform === undefined || control === undefined)
        return { ok: true, value: specializedValue.module };
      try {
        return transform(specializedValue.module, control.context);
      } finally {
        control.close();
      }
    })();
    if (!transformed.ok) return { ok: false, error: transformed.error };
    const priorConsulted = consulted.slice();
    if (control !== undefined)
      for (const record of control.records) {
        if (record === undefined) throw "runtime binding record invariant";
        if (
          !consulted.some(
            (s) =>
              s !== undefined &&
              s.function === record.subject.function &&
              s.parameter === record.subject.parameter,
          )
        )
          consulted.push(record.subject);
      }

    // Surface materialization adds syntax after specialization's hash pass.
    // Stamp the completed tree before creating identity-keyed checker indexes.
    const finalized =
      transform === undefined
        ? transformed.value
        : rewriteModule(transformed.value, { hashes: true });
    const result = checkClosureModule(finalized);
    if (!result.ok) return { ok: false, error: result.error.message };
    const prepared = result.value;
    function missing(message: string): never {
      retry = prepared;
      fail(message);
    }
    const bindingIndex = createPreparedBindingIndex(prepared);
    function functionId(name: string): number {
      const fn = bindingIndex.functionId(name);
      if (fn === undefined) fail("missing prepared runtime function: " + name);
      return fn;
    }
    function root(start: number, offset: number): number {
      const name = specializedValue.roots[start + offset];
      if (name === undefined) throw "runtime root invariant";
      return functionId(name);
    }
    function parameter(fn: number, index: number): number {
      const type = bindingIndex.parameterType(fn, index);
      if (type === undefined) throw "runtime parameter invariant";
      return type;
    }
    function preparedElement(element: CollectionElement): number {
      if (typeof element === "number") return element;
      const id = prepared.types.findIndex(
        (t) => t !== undefined && t.kind === element,
      );
      if (id < 0) throw "runtime primitive invariant";
      return id;
    }
    const matches = createElementMatcher(prepared.types).matches;
    const current = collectRuntimeRequirements(prepared);
    const unsupported = current.unsupported[0];
    if (unsupported !== undefined)
      fail(
        "specialized runtime introduced an unsupported " +
          unsupported.kind +
          " contract",
      );
    const lists: ListRuntimeBinding[] = [],
      sets: SetRuntimeBinding[] = [],
      maps: MapRuntimeBinding[] = [];
    for (const list of current.lists) {
      if (list === undefined) throw "prepared list invariant";
      let runtime: ListRuntime;
      if (list.element === "number") {
        runtime = {
          create: functionId(helper("number-list", "createNumberList")),
          read: functionId(helper("number-list", "readNumberList")),
          write: functionId(helper("number-list", "writeNumberList")),
          push: functionId(helper("number-list", "pushNumberList")),
          length: functionId(helper("number-list", "lengthNumberList")),
          has: functionId(helper("number-list", "hasNumberList")),
          delete: functionId(helper("number-list", "deleteNumberList")),
          resize: functionId(helper("number-list", "resizeNumberList")),
        };
      } else {
        const element = preparedElement(list.element);
        const start = listStarts.find(
          (start) =>
            start !== undefined &&
            matches(element, parameter(root(start, 2), 2), true),
        );
        if (start === undefined)
          missing("no specialized list helper matches the checked element");
        runtime = {
          create: root(start, 0),
          read: root(start, 1),
          write: root(start, 2),
          push: root(start, 3),
          length: root(start, 4),
          has: root(start, 5),
          delete: root(start, 6),
          resize: root(start, 7),
        };
      }
      const sorted = current.sorts.some(
        (sort) =>
          sort !== undefined &&
          matches(
            preparedElement(sort.element),
            preparedElement(list.element),
            false,
          ),
      );
      if (sorted) {
        if (list.element === "number") {
          runtime = {
            ...runtime,
            sort: functionId(helper("list-sort", "sortNumberList")),
          };
        } else {
          const element = preparedElement(list.element);
          const start = sortStarts.find((candidate): boolean => {
            if (candidate === undefined) return false;
            const comparator = prepared.types[parameter(root(candidate, 0), 1)];
            if (comparator?.kind !== "function") return false;
            const argument = comparator.parameters[0];
            return argument !== undefined && matches(element, argument, false);
          });
          if (start === undefined)
            missing("no specialized sort helper matches the checked element");
          runtime = { ...runtime, sort: root(start, 0) };
        }
      }
      lists.push({ element: list.element, runtime });
    }
    for (const set of current.sets) {
      if (set === undefined) throw "prepared set invariant";
      const element = preparedElement(set.element);
      const start = setStarts.find(
        (start) =>
          start !== undefined &&
          matches(element, parameter(root(start, 2), 1), false),
      );
      if (start === undefined)
        missing("no specialized Set helper matches the checked element");
      const runtime: SetRuntime = {
        clone: root(start, 9),
        create: root(start, 0),
        has: root(start, 1),
        add: root(start, 2),
        delete: root(start, 3),
        clear: root(start, 4),
        size: root(start, 5),
        iterator: {
          create: root(start, 6),
          advance: root(start, 7),
          read: root(start, 8),
        },
      };
      sets.push({ element: set.element, runtime });
    }
    for (const map of current.maps) {
      if (map === undefined) throw "prepared map invariant";
      const key = preparedElement(map.key),
        value = preparedElement(map.value);
      const start = mapStarts.find((candidate): boolean => {
        if (candidate === undefined) return false;
        const fn = root(candidate, 3);
        return (
          matches(key, parameter(fn, 1), false) &&
          matches(value, parameter(fn, 2), false)
        );
      });
      if (start === undefined)
        missing("no specialized Map helper matches the checked elements");
      const runtime: MapRuntime = {
        create: root(start, 0),
        get: root(start, 1),
        has: root(start, 2),
        set: root(start, 3),
        delete: root(start, 4),
        clear: root(start, 5),
        size: root(start, 6),
        iterator: {
          create: root(start, 7),
          advance: root(start, 8),
          key: root(start, 9),
          value: root(start, 10),
        },
      };
      maps.push({ key: map.key, value: map.value, runtime });
    }
    if (control !== undefined) {
      for (const record of control.records) {
        if (record === undefined) throw "runtime binding record invariant";
        const subject = record.subject;
        const id = bindingIndex.functionId(subject.function);
        const type =
          id === undefined
            ? undefined
            : bindingIndex.parameterType(id, subject.parameter);
        if (type === undefined)
          fail(
            "runtime binding subject disappeared after transform: " +
              subject.function,
          );
        const list = arrayElement(prepared, type),
          set = setElement(prepared, type),
          map = mapEncoding(prepared, type);
        const actual = new Map<string, number>();
        function put(name: string, id: number | undefined): void {
          if (id !== undefined) actual.set(name, id);
        }
        if (record.names.kind === "list" && list !== undefined) {
          const runtime = lists.find(
            (b) => b !== undefined && b.element === list,
          )?.runtime;
          if (runtime !== undefined) {
            put("create", runtime.create);
            put("read", runtime.read);
            put("write", runtime.write);
            put("push", runtime.push);
            put("length", runtime.length);
            put("has", runtime.has);
            put("delete", runtime.delete);
            put("resize", runtime.resize);
          }
        } else if (record.names.kind === "set" && set !== undefined) {
          const runtime = sets.find(
            (b) => b !== undefined && b.element === set,
          )?.runtime;
          if (runtime !== undefined) {
            put("create", runtime.create);
            put("has", runtime.has);
            put("add", runtime.add);
            put("delete", runtime.delete);
            put("clear", runtime.clear);
            put("size", runtime.size);
            put("clone", runtime.clone);
            const iterator = runtime.iterator;
            if (iterator !== undefined) {
              put("iterator.create", iterator.create);
              put("iterator.advance", iterator.advance);
              put("iterator.read", iterator.read);
            }
          }
        } else if (record.names.kind === "map" && map !== undefined) {
          const runtime = maps.find(
            (b) =>
              b !== undefined && b.key === map.key && b.value === map.value,
          )?.runtime;
          if (runtime !== undefined) {
            put("create", runtime.create);
            put("get", runtime.get);
            put("has", runtime.has);
            put("set", runtime.set);
            put("delete", runtime.delete);
            put("clear", runtime.clear);
            put("size", runtime.size);
            const iterator = runtime.iterator;
            if (iterator !== undefined) {
              put("iterator.create", iterator.create);
              put("iterator.advance", iterator.advance);
              put("iterator.key", iterator.key);
              put("iterator.value", iterator.value);
            }
          }
        }
        for (const [operation, name] of record.names.operations)
          if (actual.get(operation) !== functionId(name))
            fail(
              "runtime binding names changed after transform: " +
                subject.function,
            );
      }
      for (const subject of priorConsulted) {
        if (subject === undefined) throw "runtime binding subject invariant";
        if (
          !control.records.some(
            (r) =>
              r !== undefined &&
              r.subject.function === subject.function &&
              r.subject.parameter === subject.parameter,
          )
        )
          fail(
            "runtime binding context was not consulted on retry: " +
              subject.function,
          );
      }
    }
    function primitiveHelper(name: string): number {
      return functionId(helper("primitive-value", name));
    }
    const primitives: PrimitiveRuntime | undefined = helpers.has(
      "primitive-value:fromUndefined",
    )
      ? {
          fromNull: primitiveHelper("fromNull"),
          isNullish: primitiveHelper("isNullish"),
          fromUndefined: primitiveHelper("fromUndefined"),
          fromNumber: primitiveHelper("fromNumber"),
          fromBoolean: primitiveHelper("fromBoolean"),
          fromString: primitiveHelper("fromString"),
          fromOptionalNumber: primitiveHelper("fromOptionalNumber"),
          fromOptionalString: primitiveHelper("fromOptionalString"),
          fromOptionalBoolean: primitiveHelper("fromOptionalBoolean"),
          fromOptionalBox: primitiveHelper("fromOptionalBox"),
          readNumber: primitiveHelper("readNumber"),
          readBoolean: primitiveHelper("readBoolean"),
          readString: primitiveHelper("readString"),
          readOptionalNumber: primitiveHelper("readOptionalNumber"),
          readOptionalString: primitiveHelper("readOptionalString"),
          readOptionalBoolean: primitiveHelper("readOptionalBoolean"),
          kindOf: primitiveHelper("kindOf"),
          truthy: primitiveHelper("truthy"),
          strictEqual: primitiveHelper("strictEqual"),
          canonicalKey: primitiveHelper("canonicalKey"),
          canonicalOptionalNumber: primitiveHelper("canonicalOptionalNumber"),
        }
      : undefined;
    return {
      ok: true,
      value: {
        checked: prepared,
        options: {
          ...(helpers.has("number-text:numberToString")
            ? {
                numberToString: functionId(
                  helper("number-text", "numberToString"),
                ),
                numberFromString: functionId(
                  helper("number-text", "stringToNumber"),
                ),
              }
            : {}),
          lists,
          sets,
          maps,
          ...(primitives === undefined ? {} : { primitives }),
        },
      },
    };
  } catch (e) {
    if (e !== abort) throw e;
  }
  return { ok: false, error, retry };
}

export {
  listOperations,
  setOperations,
  mapOperations,
  primitiveOperations,
  numberTextOperations,
} from "./operations.ts";
