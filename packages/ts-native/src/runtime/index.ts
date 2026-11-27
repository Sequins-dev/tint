export {
  runtimeFunctionIds,
  visitRuntimeFunctions,
  type RuntimeFunctionKind,
  type RuntimeFunctionVisitor,
} from "./function-ids.ts";
import {
  createRuntimeBindingContext,
  type RuntimeBindingContext,
  type RuntimeBindingRecord,
  type RuntimeBindingSubject,
} from "./context.ts";
import {
  arrayElement,
  setElement,
  mapEncoding,
  listElementClass,
  mapEncodingClass,
  narrowBooleanListElement,
  presentListElement,
  usesBigInt,
} from "../closure/lowering/records.ts";
export type {
  RuntimeBindingContext,
  RuntimeBindingSubject,
  RuntimeCollectionNames,
  RuntimeCollectionLookup,
} from "./context.ts";
import { createElementMatcher, supportsCompactMapValue } from "./elements.ts";
import { createPreparedBindingIndex } from "./bindings.ts";
import {
  collectRuntimeRequirements,
  type ModuleEntryOptions,
} from "../closure/lowering/index.ts";
import type { RuntimeRequirements } from "../closure/lowering/runtime-requirements.ts";
/** A seeded pass derives its requests from a plan, not observed demand. */
const noDemand: RuntimeRequirements = {
  lists: [],
  sets: [],
  maps: [],
  sorts: [],
  unsupported: [],
};
import {
  checkClosureModule,
  type CheckedClosures,
  type ClosureDiagnostic,
  type CViewRegistry,
  type InterfaceResolutionCache,
} from "@tint/typescript/checker";
import {
  reifyCheckedRoots,
  specializeReifiedRoots,
  type CheckedSpecializationRoot,
} from "../modules/index.ts";
import { type Type } from "@tint/typescript/types";
import {
  rewriteModule,
  type Module,
  type Statement,
  type TypeNode,
} from "@tint/typescript/syntax";
import type {
  ListRuntime,
  SetRuntime,
  MapRuntime,
  ListRuntimeBinding,
  SetRuntimeBinding,
  MapRuntimeBinding,
  CollectionElement,
  PrimitiveRuntime,
  BigIntRuntime,
} from "../scalar.ts";
/** The reified helper requests of a converged pass. Roots name helpers by
 * `namespace:export`, so a plan stays meaningful for another linking of the
 * same runtime providers; its declarations belong to no checked graph. */
export interface CollectionRuntimePlan {
  readonly declarations: readonly Statement[];
  readonly roots: readonly {
    readonly helper: string;
    readonly arguments: readonly TypeNode[];
  }[];
  readonly listStarts: readonly number[];
  readonly setStarts: readonly number[];
  readonly mapStarts: readonly number[];
  readonly sortStarts: readonly number[];
}
interface PreparedCollectionRuntime {
  readonly checked: CheckedClosures;
  readonly options: ModuleEntryOptions;
  readonly plan: CollectionRuntimePlan;
}
interface RuntimePreparationError {
  readonly ok: false;
  readonly error: string;
  readonly diagnostic?: ClosureDiagnostic;
}
export type RuntimePreparation =
  | {
      readonly ok: true;
      readonly value: PreparedCollectionRuntime;
    }
  | RuntimePreparationError;
export type RuntimeModuleTransform = (
  module: Module,
  context: RuntimeBindingContext,
) =>
  | { readonly ok: true; readonly value: Module }
  | { readonly ok: false; readonly error: string };
/** Compiler-issued exact contract equality. Sharing never changes source type
 * identities or the per-type runtime bindings produced below. */
export type RuntimeTypeEquivalenceFactory = (
  types: readonly Type[],
) => (left: number, right: number) => boolean;
/** The checked graph to consume. A pass publishes a new graph only on retry. */
export interface CollectionRuntimeObservation {
  checked: CheckedClosures | undefined;
}
/** Templates are linked alongside the source; helpers maps namespace:export to its linked name. */
export function prepareCollectionRuntimes(
  module: Module,
  checked: CheckedClosures,
  helpers: ReadonlyMap<string, string>,
  globals: readonly string[],
  transform?: RuntimeModuleTransform,
  maxSpecializations: number = 8192,
  equivalence?: RuntimeTypeEquivalenceFactory,
  interfaceCache?: InterfaceResolutionCache,
  /** Share one list instantiation among plain record elements. Only for
   * programs whose runtime functions are not published per element
   * contract (managed surfaces and service imports key them by element). */
  eraseRecordLists: boolean = false,
): RuntimePreparation {
  return prepareObservedCollectionRuntimes(
    module,
    { checked },
    helpers,
    globals,
    transform,
    maxSpecializations,
    equivalence,
    interfaceCache,
    eraseRecordLists,
  );
}
/** Prepare collection helpers, taking ownership of the observed graph. */
export function prepareObservedCollectionRuntimes(
  module: Module,
  observation: CollectionRuntimeObservation,
  helpers: ReadonlyMap<string, string>,
  globals: readonly string[],
  transform: RuntimeModuleTransform | undefined,
  maxSpecializations: number,
  equivalence: RuntimeTypeEquivalenceFactory | undefined,
  interfaceCache: InterfaceResolutionCache | undefined,
  eraseRecordLists: boolean,
): RuntimePreparation {
  const consulted: RuntimeBindingSubject[] = [];
  while (true) {
    const result = prepareCollectionPass(
      module,
      observation,
      helpers,
      globals,
      transform,
      maxSpecializations,
      consulted,
      undefined,
      equivalence,
      interfaceCache,
      eraseRecordLists,
    );
    if (result.ok || !result.retry) return result;
  }
}
// SparseList helpers only move their elements (no equality, typeof or
// property access), so unsorted elements of one encoding class share one
// instantiation (listElementClass): the helpers' IR and record layouts are
// identical for all of them, as the post-lowering list aliasing already
// proves. One specialization per class replaces one per element type, and an
// element first seen inside a specialized helper needs no retry pass.
type CollectionPass =
  | { readonly ok: true; readonly value: PreparedCollectionRuntime }
  | (RuntimePreparationError & { readonly retry: boolean });
interface CollectionPassInput {
  module: Module;
  readonly needsHashes: boolean;
  readonly plan: CollectionRuntimePlan;
  readonly roots: readonly string[];
  readonly records: readonly RuntimeBindingRecord[] | undefined;
  readonly cViews: CViewRegistry | undefined;
  readonly realmImports: ReadonlyMap<string, "callable" | "value"> | undefined;
  readonly hasBigInt: boolean;
  readonly demandCount: number;
}
function requirementCount(demand: RuntimeRequirements): number {
  return (
    demand.lists.length +
    demand.sets.length +
    demand.maps.length +
    demand.sorts.length
  );
}
export type CollectionPlanAttempt =
  | { readonly kind: "prepared"; readonly value: PreparedCollectionRuntime }
  | { readonly kind: "unusable" };
/** One pass seeded by an earlier converged plan instead of the demand of a
 * separately checked graph. The usual validation still matches every demand
 * of the resulting graph to a specialized helper; any shortfall or failure
 * reports `unusable` so the caller repeats the ordinary preparation. */
export function prepareCollectionRuntimesFromPlan(
  module: Module,
  plan: CollectionRuntimePlan,
  helpers: ReadonlyMap<string, string>,
  globals: readonly string[],
  maxSpecializations: number = 8192,
  interfaceCache?: InterfaceResolutionCache,
): CollectionPlanAttempt {
  const result = prepareCollectionPass(
    module,
    undefined,
    helpers,
    globals,
    undefined,
    maxSpecializations,
    [],
    plan,
    undefined,
    interfaceCache,
  );
  return result.ok
    ? { kind: "prepared", value: result.value }
    : { kind: "unusable" };
}
function prepareCollectionPass(
  module: Module,
  observation: CollectionRuntimeObservation | undefined,
  helpers: ReadonlyMap<string, string>,
  globals: readonly string[],
  transform: RuntimeModuleTransform | undefined,
  maxSpecializations: number,
  consulted: RuntimeBindingSubject[],
  seed?: CollectionRuntimePlan,
  equivalence?: RuntimeTypeEquivalenceFactory,
  interfaceCache?: InterfaceResolutionCache,
  eraseRecordLists: boolean = false,
): CollectionPass {
  let retry = false;
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
  // Keep the observed checker indexes and the intermediate syntax in this
  // frame. Only the finalized tree and binding facts go to the next checker.
  function prepareInput(): CollectionPassInput {
    const checked = observation?.checked;
    if (observation !== undefined) observation.checked = undefined;
    if (
      checked === undefined &&
      (seed === undefined || transform !== undefined)
    )
      fail("collection preparation requires an observed graph");
    const demand =
      checked === undefined ? noDemand : collectRuntimeRequirements(checked);
    const unsupported = demand.unsupported[0];
    if (unsupported !== undefined)
      fail(
        "unsupported " +
          unsupported.kind +
          " runtime element at type " +
          String(unsupported.type),
      );
    const types: Type[] = checked === undefined ? [] : checked.types.slice();
    function primitive(
      name: "number" | "string" | "boolean" | "undefined",
    ): number {
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
    const requests: CheckedSpecializationRoot[] = [],
      requestHelpers: string[] = [];
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
        requestHelpers.push(namespace + ":" + name);
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
    // Sorted elements keep their own instantiation: the sort helper and its
    // comparator are typed by the element, and share its list header type.
    const erasedClasses = new Set<string>();
    const observed = checked,
      sortedElements = new Set<number>();
    for (const sort of demand.sorts) {
      if (sort === undefined) throw "sort demand invariant";
      const element = sort.element;
      if (typeof element === "number") sortedElements.add(element);
    }
    // Boolean-encoded elements narrower than boolean share one instantiation
    // for the whole encoding (see narrowBooleanListElement).
    const widenedBooleans = new Set<string>();
    for (const list of demand.lists) {
      if (list === undefined) throw "list demand invariant";
      const demanded = list.element;
      if (
        typeof demanded === "number" &&
        observed !== undefined &&
        !sortedElements.has(demanded) &&
        narrowBooleanListElement(observed, demanded)
      ) {
        const encoding = listElementClass(observed, demanded);
        if (encoding !== undefined) widenedBooleans.add(encoding);
      }
    }
    let wideBooleanRequested = false;
    for (const list of demand.lists) {
      if (list === undefined) throw "list demand invariant";
      const demanded = list.element;
      if (demanded === "number") continue;
      let erasure: string | undefined = undefined,
        wide = false;
      if (
        observed !== undefined &&
        typeof demanded === "number" &&
        !sortedElements.has(demanded)
      ) {
        if (eraseRecordLists) erasure = listElementClass(observed, demanded);
        wide =
          narrowBooleanListElement(observed, demanded) ||
          (erasure !== undefined && widenedBooleans.has(erasure));
      }
      if (erasure !== undefined) {
        if (erasedClasses.has(erasure)) continue;
        erasedClasses.add(erasure);
      }
      if (wide) {
        if (wideBooleanRequested) continue;
        wideBooleanRequested = true;
      }
      listStarts.push(
        request("sparse-list", listNames, [
          optional(wide ? primitive("boolean") : elementType(list.element)),
        ]),
      );
    }
    const hasNumberKeySet = helpers.has("number-key-set:createSet");
    for (const set of demand.sets) {
      if (set === undefined) throw "set demand invariant";
      if (set.element === "number" && hasNumberKeySet) continue;
      setStarts.push(
        request("linked-set", setNames, [elementType(set.element)]),
      );
    }
    const hasNumberNumberMap = helpers.has("number-number-map:createMap");
    const hasStringNumberMap = helpers.has("string-number-map:createMap");
    const erasedMaps = new Set<string>();
    for (const map of demand.maps) {
      if (map === undefined) throw "map demand invariant";
      if (
        map.value === "number" &&
        ((map.key === "number" && hasNumberNumberMap) ||
          (map.key === "string" && hasStringNumberMap))
      )
        continue;
      const erasure =
        eraseRecordLists && observed !== undefined
          ? mapEncodingClass(observed, map.key, map.value)
          : undefined;
      if (erasure !== undefined) {
        if (erasedMaps.has(erasure)) continue;
        erasedMaps.add(erasure);
      }
      // Number and string keys use compact open-addressed specializations when
      // their value type fits a parallel list; others use linked-map.
      mapStarts.push(
        (map.key === "number" || map.key === "string") &&
          supportsCompactMapValue(types, map.value)
          ? request(
              map.key === "number" ? "number-key-map" : "string-key-map",
              mapNames,
              [elementType(map.value)],
            )
          : request("linked-map", mapNames, [
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
    // Exact contract equivalence (compiler-issued) lets requests whose type
    // arguments differ only in graph identity share one reified root. Every
    // request keeps its own plan root, so seeded plans retain their layout.
    const sharedRequests: CheckedSpecializationRoot[] = [],
      rootAliases: number[] = [];
    const equalType = checked === undefined ? undefined : equivalence?.(types);
    const byName = new Map<string, number[]>();
    for (const requested of requests) {
      if (requested === undefined) throw "runtime request invariant";
      let selected: number | undefined = undefined;
      const candidates = byName.get(requested.name) ?? [];
      if (equalType !== undefined)
        for (const candidate of candidates) {
          if (candidate === undefined)
            throw "runtime request candidate invariant";
          const previous = sharedRequests[candidate];
          if (previous === undefined) throw "shared runtime request invariant";
          if (previous.arguments.length !== requested.arguments.length)
            continue;
          let same = true;
          for (let index = 0; index < previous.arguments.length; index++) {
            const left = previous.arguments[index],
              right = requested.arguments[index];
            if (left === undefined || right === undefined)
              throw "runtime type argument invariant";
            if (left !== right && !equalType(left, right)) {
              same = false;
              break;
            }
          }
          if (same) {
            selected = candidate;
            break;
          }
        }
      if (selected === undefined) {
        selected = sharedRequests.length;
        sharedRequests.push(requested);
        candidates.push(selected);
        byName.set(requested.name, candidates);
      }
      rootAliases.push(selected);
    }
    function reifiedPlan(): CollectionRuntimePlan {
      const reified = reifyCheckedRoots(module, types, sharedRequests);
      if (!reified.ok) fail(reified.error.message);
      const roots: { helper: string; arguments: readonly TypeNode[] }[] = [];
      for (let index = 0; index < requestHelpers.length; index++) {
        const alias = rootAliases[index],
          key = requestHelpers[index];
        if (alias === undefined || key === undefined)
          throw "reified request invariant";
        const root = reified.value.roots[alias];
        if (root === undefined) throw "reified request invariant";
        roots.push({ helper: key, arguments: root.arguments });
      }
      return {
        declarations: reified.value.declarations,
        roots,
        listStarts: listStarts.slice(),
        setStarts: setStarts.slice(),
        mapStarts: mapStarts.slice(),
        sortStarts: sortStarts.slice(),
      };
    }
    // A seeded pass adopts the plan's requests in place of observed demand.
    const plan: CollectionRuntimePlan =
      seed !== undefined && checked === undefined ? seed : reifiedPlan();
    if (plan === seed)
      for (const starts of [
        plan.listStarts,
        plan.setStarts,
        plan.mapStarts,
        plan.sortStarts,
      ])
        for (const start of starts)
          if (start === undefined) throw "collection plan start invariant";
    const named: { name: string; arguments: readonly TypeNode[] }[] = [];
    for (const root of plan.roots) {
      if (root === undefined) throw "collection plan root invariant";
      const linked = helpers.get(root.helper);
      if (linked === undefined) fail("missing runtime helper: " + root.helper);
      named.push({ name: linked, arguments: root.arguments });
    }
    const specialized = specializeReifiedRoots(
      module,
      { declarations: plan.declarations, roots: named },
      globals,
      maxSpecializations,
    );
    if (!specialized.ok)
      fail(
        specialized.error.message +
          " (runtime demand: " +
          String(plan.listStarts.length) +
          " lists, " +
          String(plan.setStarts.length) +
          " sets, " +
          String(plan.mapStarts.length) +
          " maps, " +
          String(plan.roots.length) +
          " roots, " +
          String(sharedRequests.length) +
          " shared)",
      );
    const specializedValue = specialized.value;
    const control =
      transform === undefined || checked === undefined
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
            eraseRecordLists,
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
    if (!transformed.ok) fail(transformed.error);

    // Return the unfinalized syntax so the observed checker graph in this
    // frame can die before the whole-tree hash pass and transformed recheck.
    return {
      module: transformed.value,
      needsHashes: transform !== undefined,
      plan,
      roots: specializedValue.roots,
      records: control?.records,
      cViews: checked?.cViews,
      realmImports: checked?.realmImports,
      hasBigInt:
        helpers.has("bigint:literal") &&
        checked !== undefined &&
        usesBigInt(checked),
      demandCount: requirementCount(demand),
    };
  }
  try {
    const input = prepareInput(),
      plan = input.plan,
      records = input.records,
      listStarts = plan.listStarts,
      setStarts = plan.setStarts,
      mapStarts = plan.mapStarts,
      sortStarts = plan.sortStarts;
    // Surface materialization adds syntax after specialization's hash pass.
    // Stamp the completed tree here after prepareInput's frame has released
    // the observed checker, replacing the unhashed tree in place before
    // creating identity-keyed checker indexes.
    if (input.needsHashes)
      input.module = rewriteModule(input.module, { hashes: true });
    const priorConsulted = consulted.slice();
    if (records !== undefined)
      for (const record of records) {
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
    // C views keep the registry the program was first checked with.
    const result = checkClosureModule(input.module, {
      interfaceCache,
      cViews: input.cViews,
      realmImports: input.realmImports,
    });
    if (!result.ok)
      return {
        ok: false,
        error: result.error.message,
        diagnostic: result.error,
        retry: false,
      };
    const prepared = result.value;
    const bindingIndex = createPreparedBindingIndex(prepared);
    function functionId(name: string): number {
      const fn = bindingIndex.functionId(name);
      if (fn === undefined) fail("missing prepared runtime function: " + name);
      return fn;
    }
    function root(start: number, offset: number): number {
      const name = input.roots[start + offset];
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
    const owned = prepared.typeSystem;
    const matches = createElementMatcher(
      prepared.types,
      owned !== undefined && owned.types === prepared.types
        ? owned.system
        : undefined,
    ).matches;
    const current = collectRuntimeRequirements(prepared);
    function missing(message: string): never {
      const owner = observation;
      if (owner !== undefined) {
        // Each retry must discover another contract. The specialization
        // budget bounds an expanding helper graph.
        if (requirementCount(current) <= input.demandCount)
          fail("runtime requirements did not converge: " + message);
        owner.checked = prepared;
        retry = true;
      }
      fail(message);
    }
    const unsupported = current.unsupported[0];
    if (unsupported !== undefined)
      fail(
        "specialized runtime introduced an unsupported " +
          unsupported.kind +
          " contract",
      );
    const lists: ListRuntimeBinding[] = [],
      /** List elements bound to the shared boolean instantiation. */
      widened = new Set<CollectionElement>(),
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
          pop: functionId(helper("number-list", "popNumberList")),
          wrap: helpers.has("number-list:wrapNumberList")
            ? functionId(helper("number-list", "wrapNumberList"))
            : undefined,
          empty: helpers.has("number-list:emptyNumberList")
            ? functionId(helper("number-list", "emptyNumberList"))
            : undefined,
        };
      } else {
        const element = preparedElement(list.element);
        // An exact instantiation wins; an unsorted plain record otherwise
        // shares the erased one (see erasedListElement).
        const erased =
          eraseRecordLists &&
          !current.sorts.some(
            (sort) =>
              sort !== undefined &&
              matches(preparedElement(sort.element), element, false),
          )
            ? listElementClass(prepared, element)
            : undefined;
        const unsorted = !current.sorts.some(
          (sort) =>
            sort !== undefined &&
            matches(preparedElement(sort.element), element, false),
        );
        // A narrow boolean element uses the boolean instantiation.
        const wide = unsorted && narrowBooleanListElement(prepared, element);
        if (wide) widened.add(list.element);
        const target = wide
          ? prepared.types.findIndex(
              (t) => t !== undefined && t.kind === "boolean",
            )
          : element;
        if (target < 0) throw "runtime boolean invariant";
        const start =
          listStarts.find(
            (start) =>
              start !== undefined &&
              matches(target, parameter(root(start, 2), 2), true),
          ) ??
          (erased !== undefined
            ? listStarts.find(
                (start) =>
                  start !== undefined &&
                  listElementClass(
                    prepared,
                    presentListElement(prepared, parameter(root(start, 2), 2)),
                  ) === erased,
              )
            : undefined);
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
      lists.push(
        list.element === "number" ||
          (!eraseRecordLists && !widened.has(list.element))
          ? { element: list.element, runtime }
          : { element: list.element, runtime, erasedRecords: true },
      );
    }
    const hasNumberKeySet = helpers.has("number-key-set:createSet");
    for (const set of current.sets) {
      if (set === undefined) throw "prepared set invariant";
      let runtime: SetRuntime;
      if (set.element === "number" && hasNumberKeySet) {
        runtime = {
          clone: functionId(helper("number-key-set", "cloneSet")),
          create: functionId(helper("number-key-set", "createSet")),
          has: functionId(helper("number-key-set", "hasSet")),
          add: functionId(helper("number-key-set", "addSet")),
          delete: functionId(helper("number-key-set", "deleteSet")),
          clear: functionId(helper("number-key-set", "clearSet")),
          size: functionId(helper("number-key-set", "sizeSet")),
          iterator: {
            create: functionId(helper("number-key-set", "createSetCursor")),
            advance: functionId(helper("number-key-set", "advanceSetCursor")),
            read: functionId(helper("number-key-set", "readSetCursor")),
          },
        };
      } else {
        const element = preparedElement(set.element);
        const start = setStarts.find(
          (start) =>
            start !== undefined &&
            matches(element, parameter(root(start, 2), 1), false),
        );
        if (start === undefined)
          missing("no specialized Set helper matches the checked element");
        runtime = {
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
      }
      sets.push({ element: set.element, runtime });
    }
    const hasNumberNumberMap = helpers.has("number-number-map:createMap");
    const hasStringNumberMap = helpers.has("string-number-map:createMap");
    for (const map of current.maps) {
      if (map === undefined) throw "prepared map invariant";
      const directNamespace =
        map.value === "number"
          ? map.key === "number" && hasNumberNumberMap
            ? "number-number-map"
            : map.key === "string" && hasStringNumberMap
              ? "string-number-map"
              : undefined
          : undefined;
      if (directNamespace !== undefined) {
        const runtime: MapRuntime = {
          create: functionId(helper(directNamespace, "createMap")),
          get: functionId(helper(directNamespace, "getMap")),
          has: functionId(helper(directNamespace, "hasMap")),
          set: functionId(helper(directNamespace, "setMap")),
          delete: functionId(helper(directNamespace, "deleteMap")),
          clear: functionId(helper(directNamespace, "clearMap")),
          size: functionId(helper(directNamespace, "sizeMap")),
          iterator: {
            create: functionId(helper(directNamespace, "createMapCursor")),
            advance: functionId(helper(directNamespace, "advanceMapCursor")),
            key: functionId(helper(directNamespace, "readMapCursorKey")),
            value: functionId(helper(directNamespace, "readMapCursorValue")),
          },
        };
        maps.push(
          eraseRecordLists
            ? { key: map.key, value: map.value, runtime, erasedRecords: true }
            : { key: map.key, value: map.value, runtime },
        );
        continue;
      }
      const key = preparedElement(map.key),
        value = preparedElement(map.value);
      // An exact instantiation wins; otherwise one of the same encoding
      // class (see mapEncodingClass).
      const erasure = eraseRecordLists
        ? mapEncodingClass(prepared, key, value)
        : undefined;
      const start =
        mapStarts.find((candidate): boolean => {
          if (candidate === undefined) return false;
          const fn = root(candidate, 3);
          return (
            matches(key, parameter(fn, 1), false) &&
            matches(value, parameter(fn, 2), false)
          );
        }) ??
        (erasure !== undefined
          ? mapStarts.find((candidate): boolean => {
              if (candidate === undefined) return false;
              const fn = root(candidate, 3);
              return (
                mapEncodingClass(
                  prepared,
                  parameter(fn, 1),
                  parameter(fn, 2),
                ) === erasure
              );
            })
          : undefined);
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
      maps.push(
        eraseRecordLists
          ? { key: map.key, value: map.value, runtime, erasedRecords: true }
          : { key: map.key, value: map.value, runtime },
      );
    }
    if (records !== undefined) {
      for (const record of records) {
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
          !records.some(
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
    function bigIntHelper(name: string): number {
      return functionId(helper("bigint", name));
    }
    const bigints: BigIntRuntime | undefined = input.hasBigInt
      ? {
          literal: bigIntHelper("literal"),
          binary: {
            "+": bigIntHelper("addBigInt"),
            "-": bigIntHelper("subtractBigInt"),
            "*": bigIntHelper("multiplyBigInt"),
            "/": bigIntHelper("divideBigInt"),
            "%": bigIntHelper("remainderBigInt"),
            "**": bigIntHelper("exponentiateBigInt"),
            "&": bigIntHelper("andBigInt"),
            "|": bigIntHelper("orBigInt"),
            "^": bigIntHelper("xorBigInt"),
            "<<": bigIntHelper("leftShiftBigInt"),
            ">>": bigIntHelper("rightShiftBigInt"),
          },
          negate: bigIntHelper("negateBigInt"),
          not: bigIntHelper("notBigInt"),
          compare: bigIntHelper("compareBigInt"),
          compareNumber: bigIntHelper("compareBigIntNumber"),
          equal: bigIntHelper("equalBigInt"),
          truthy: bigIntHelper("truthyBigInt"),
          toString: bigIntHelper("bigIntToString"),
          toNumber: bigIntHelper("bigIntToNumber"),
          fromNumber: bigIntHelper("bigIntFromNumber"),
          fromBoolean: bigIntHelper("bigIntFromBoolean"),
          asWidth: bigIntHelper("bigIntAsWidth"),
          toWord64: bigIntHelper("bigIntToWord64"),
          fromWord64: bigIntHelper("bigIntFromWord64"),
          hash: bigIntHelper("hashBigInt"),
        }
      : undefined;
    const builtinHelpers = new Map<string, number>();
    const optionalHelperKeys: readonly string[] = [
      "math:mathPow",
      "math:mathExp",
      "math:mathExpm1",
      "math:mathLog",
      "math:mathLog2",
      "math:mathLog10",
      "math:mathLog1p",
      "math:mathCbrt",
      "math:mathFround",
      "math:mathF16round",
      "math:mathSin",
      "math:mathCos",
      "math:mathTan",
      "math:mathAsin",
      "math:mathAcos",
      "math:mathAtan",
      "math:mathAtan2",
      "math:mathSinh",
      "math:mathCosh",
      "math:mathTanh",
      "math:mathAsinh",
      "math:mathAcosh",
      "math:mathAtanh",
      "math:mathHypot2",
      "math:mathHypot3",
      "math:mathHypot",
      "data-view:dataViewCreate",
      "data-view:dataViewBytes",
      "data-view:dataViewGetInt8",
      "data-view:dataViewGetUint8",
      "data-view:dataViewGetInt16",
      "data-view:dataViewGetUint16",
      "data-view:dataViewGetInt32",
      "data-view:dataViewGetUint32",
      "data-view:dataViewGetFloat16",
      "data-view:dataViewGetFloat32",
      "data-view:dataViewGetFloat64",
      "data-view:dataViewGetBigInt64",
      "data-view:dataViewGetBigUint64",
      "data-view:dataViewReadWord64",
      "data-view:dataViewWriteWord64",
      "data-view:dataViewSetInt8",
      "data-view:dataViewSetUint8",
      "data-view:dataViewSetInt16",
      "data-view:dataViewSetUint16",
      "data-view:dataViewSetInt32",
      "data-view:dataViewSetUint32",
      "data-view:dataViewSetFloat16",
      "data-view:dataViewSetFloat32",
      "data-view:dataViewSetFloat64",
      "data-view:dataViewSetBigInt64",
      "data-view:dataViewSetBigUint64",
      "string-builtins:stringReplace",
      "string-builtins:stringReplaceAll",
      "number-format:formatNumberFixed",
      "number-format:formatNumberExponential",
      "number-format:formatNumberPrecision",
      "number-format:formatNumberToString",
      "unicode-casing:unicodeLowercase",
      "unicode-casing:unicodeUppercase",
      "unicode-normalization:normalizeString",
      "text-encoding:isWellFormedUTF16",
      "text-encoding:toWellFormedUTF16",
    ];
    for (const key of optionalHelperKeys) {
      if (key === undefined) throw "builtin helper key invariant";
      const linkedName = helpers.get(key);
      if (linkedName !== undefined)
        builtinHelpers.set(key, functionId(linkedName));
    }
    const identityHashGcEpoch =
      helpers.get("linked-map:gcEpoch") ?? helpers.get("linked-set:gcEpoch");
    const identityHashRef =
      helpers.get("linked-map:referenceHash") ??
      helpers.get("linked-set:referenceHash");
    const identityHashUsesAddress =
      helpers.get("linked-map:usesAddressHash") ??
      helpers.get("linked-set:usesAddressHash");
    const identityHash =
      identityHashGcEpoch !== undefined &&
      identityHashRef !== undefined &&
      identityHashUsesAddress !== undefined
        ? {
            gcEpoch: functionId(identityHashGcEpoch),
            referenceHash: functionId(identityHashRef),
            usesAddressHash: functionId(identityHashUsesAddress),
          }
        : undefined;
    return {
      ok: true,
      value: {
        checked: prepared,
        plan,
        options: {
          builtinHelpers:
            builtinHelpers.size === 0 ? undefined : builtinHelpers,
          identityHash,
          ...(helpers.has("number-text:numberToString")
            ? {
                numberToString: functionId(
                  helper(
                    "number-text",
                    helpers.has("number-text:numberToStringMissed")
                      ? "numberToStringMissed"
                      : "numberToString",
                  ),
                ),
                numberFromString: functionId(
                  helper("number-text", "stringToNumber"),
                ),
              }
            : {}),
          ...(helpers.has("native-shared-buffer:newSharedBlock")
            ? {
                sharedBlock: functionId(
                  helper("native-shared-buffer", "newSharedBlock"),
                ),
              }
            : {}),
          ...(helpers.has("native-shared-buffer:isNativeSharedArrayBuffer")
            ? {
                sharedBlockCheck: functionId(
                  helper("native-shared-buffer", "isNativeSharedArrayBuffer"),
                ),
              }
            : {}),
          ...(helpers.has("native-shared-buffer:nativeAtomicsWait")
            ? {
                atomicsWait: functionId(
                  helper("native-shared-buffer", "nativeAtomicsWait"),
                ),
              }
            : {}),
          ...(helpers.has("native-shared-buffer:nativeAtomicsNotify")
            ? {
                atomicsNotify: functionId(
                  helper("native-shared-buffer", "nativeAtomicsNotify"),
                ),
              }
            : {}),
          lists,
          sets,
          maps,
          ...(primitives === undefined ? {} : { primitives }),
          ...(bigints === undefined ? {} : { bigints }),
          ...(helpers.has("bigint:literal")
            ? { bigIntRepresentation: bigIntHelper("literal") }
            : {}),
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
