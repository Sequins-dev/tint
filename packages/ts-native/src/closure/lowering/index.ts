export {
  insertDynamicObjectRuntime,
  usesDynamicObjectRuntime,
  usesRealmInstanceof,
} from "./dynamic-objects.ts";
import {
  validateFunctionAddressBindings,
  bindFunctionAddress,
  type FunctionAddressBinding,
} from "./function-bindings.ts";
export type { FunctionAddressBinding } from "./function-bindings.ts";
export {
  buildClassDefinition,
  type ClassDefinitionPlan,
  type ClassDefinitionClosure,
  type ClassDefinitionEntry,
  type ClassDefinitionBinding,
} from "./class-definition.ts";
export {
  buildClassConstruction,
  buildClassStaticInitialization,
  type ClassStaticInitializationPlan,
  type ClassConstructionPlan,
  type ClassConstructionEntry,
  type ClassFieldInitialization,
} from "./class-construction.ts";
export type { RecordOperation } from "./record-bindings.ts";
import {
  arrayFlowReceiver,
  encodeDynamicContract,
  hasDynamicObject,
  dynamicObjectRuntime,
  planFlowPropertyStorage,
  dynamicRuntimeAliasPrefix,
  type DynamicObjectRuntime,
} from "./dynamic-objects.ts";
import type { RecordOperation } from "./record-bindings.ts";
import { bindRecordOperation } from "./record-bindings.ts";
import { incompatibleRepresentationView } from "./representation-views.ts";
import {
  checkedPropertyName,
  numericConstant,
  realmLibraryConstructor,
} from "@tint/typescript/checker";
import { syntaxHash } from "@tint/typescript/syntax";
import type { Binding as BoundBinding } from "@tint/typescript/binding";
import { createKeyIndex } from "@tint/foundation/collections/key-index";
import {
  createRecordContracts,
  createRepresentationMemo,
  entryType,
  listElementClass,
  presentListElement,
  setElement,
  arrayElement,
  mapEncoding,
  stringType,
  bigIntType,
  usesBigInt,
  admitsUndefined,
  type RecordContracts,
  type RecordIdentityResolver,
} from "./records.ts";
import {
  createTypeSystem,
  type Result as TypeResult,
  type TypeSystem,
} from "@tint/typescript/types";
import { directFunctions, scalarType, planCaptures } from "./planning.ts";
import type {
  ScalarType as SourceScalarType,
  CheckedClosures,
  ClosureBody,
  CheckedFunction,
  Local,
  ExpressionInfo,
  DowncastTest,
  CViewUse,
} from "@tint/typescript/checker";
import type {
  Expression,
  Statement,
  Parameter,
  Binding,
  Span,
  BlockStatement,
} from "@tint/typescript/syntax";
import type { EnvironmentLayout, TargetDataLayout } from "../layout.ts";
import {
  lowerFunction,
  nativeClosureCallMessage,
  type FunctionSignature,
  type OwnedEnvironmentPlan,
  type OwnedHoistedFunction,
  type OwnedCell,
  type OwnedConstructor,
  type FiniteRecordAccess,
  type ListRuntimeBinding,
  type CollectionElement,
  type SetRuntimeBinding,
  type MapRuntimeBinding,
  type PrimitiveRuntime,
  type BigIntRuntime,
  type RealmErrorRuntime,
} from "../../scalar.ts";
import {
  verify,
  instructionResult,
  type ModuleIR,
  type FunctionIR,
  type Block,
  type Instruction,
  type Terminator,
  type ScalarType,
  type Environment,
  type Span as IRSpan,
  type SourceVariable,
  type SlotBinding,
  scalarByteLength,
  recordHeaderBytes,
  recordAllocationAlignment,
} from "@tint/ir/scalar";
export type Result =
  | {
      readonly ok: true;
      readonly value: {
        readonly module: ModuleIR;
        /** Native function index to checked source function ID; excludes witnesses. */
        readonly entries: readonly number[];
        readonly recordTypes: readonly (number | undefined)[] | undefined;
        /** Checked function type ID to semantic witness ID plus one. */
        readonly signatureTypes: Uint32Array | undefined;
      };
    }
  | {
      readonly ok: false;
      readonly error: string;
      readonly fallback?: LoweringFallback;
    };
export interface LoweringFallback {
  readonly capability: "native-callable-view";
  readonly location: IRSpan;
  readonly owner: IRSpan;
}
/** A record extent rounded up to the managed allocation granule. */
function alignAllocation(bytes: number): number {
  return (
    Math.ceil(bytes / recordAllocationAlignment) * recordAllocationAlignment
  );
}
export function lowerClosureEntries(
  checked: CheckedClosures,
  entries: readonly number[],
  layout: EnvironmentLayout,
): Result {
  return lowerEntries(checked, entries, layout, undefined);
}
interface RealmTypeof {
  readonly function: number;
  readonly applies: (span: IRSpan) => boolean;
}
interface RealmErrorSources {
  readonly view: number;
  readonly operation: number;
  readonly error: number;
  readonly typeError: number;
  readonly rangeError: number;
  readonly applies: (span: IRSpan) => boolean;
}

interface NodeErrorTypes {
  readonly coded?: number | undefined;
  readonly type?: number | undefined;
  readonly range?: number | undefined;
  readonly system?: number | undefined;
  readonly info?: number | undefined;
}
export interface ModuleEntryOptions {
  readonly realmTypeof?: RealmTypeof | undefined;
  readonly realmCall?: number | undefined;
  readonly realmConstruct?: number | undefined;
  readonly realmErrors?: RealmErrorSources | undefined;
  readonly nodeErrorTypes?: NodeErrorTypes | undefined;
  /** Caller-selected top-level managed functions supplied by the linker. Their
   * checked ABI is lowered, but their bodies and child closures are not. */
  readonly importedFunctions?: readonly number[];
  readonly functionAddressBindings?: readonly FunctionAddressBinding[];
  /** Keep checked callback types distinct even when their machine ABIs match. */
  readonly signatureTypes?: boolean;
  /** Snapshot checked type ID to emitted record ID for authorized linking. */
  readonly recordTypes?: boolean;
  /** Optional checked-type identity partition for otherwise equal record storage. */
  readonly recordIdentity?: RecordIdentityResolver;
  /** Caller-authorized module functions with a checked record test or view result. */
  readonly recordBindings?: readonly RecordBinding[];
  readonly primitives?: PrimitiveRuntime;
  /** Checked function IDs of the BigInt helpers (native-runtime values/bigint). */
  readonly bigints?: BigIntRuntime;
  /** A checked function whose result type is js-runtime's BigIntValue, so a
   * general value can be tested for being a BigInt (typeof, downcasts). */
  readonly bigIntRepresentation?: number;
  readonly numberFromString?: number;
  readonly numberToString?: number;
  readonly lists?: readonly ListRuntimeBinding[];
  readonly sets?: readonly SetRuntimeBinding[];
  readonly maps?: readonly MapRuntimeBinding[];
  /** Attach source-debugging metadata (slot names, record names) to the IR. */
  readonly debug?: boolean;
}
export interface RecordBinding {
  readonly function: number;
  readonly operation: RecordOperation;
}
export function lowerModuleEntries(
  checked: CheckedClosures,
  entries: readonly number[],
  target: TargetDataLayout,
  maxBytes: number,
  options?: ModuleEntryOptions,
): Result {
  const expanded: number[] = [];
  const imported = new Set<number>();
  for (const id of options?.importedFunctions ?? []) {
    if (id === undefined || !Number.isInteger(id) || id < 0 || imported.has(id))
      return { ok: false, error: "invalid or duplicate imported function" };
    const fn = checked.bindings.functions[id];
    if (fn === undefined || fn.parent !== undefined)
      return {
        ok: false,
        error: "imported functions must be checked top-level functions",
      };
    imported.add(id);
  }
  const addressBindings = options?.functionAddressBindings ?? [];
  const addressStubs = new Set<number>();
  if (addressBindings.length > 0) {
    const recordBound = new Set<number>();
    for (const binding of options?.recordBindings ?? []) {
      if (binding === undefined)
        return {
          ok: false,
          error: "function address binding record capability is missing",
        };
      recordBound.add(binding.function);
    }
    const invalid = validateFunctionAddressBindings(
      checked,
      entries,
      addressBindings,
      imported,
      recordBound,
    );
    if (invalid !== undefined) return { ok: false, error: invalid };
    for (const binding of addressBindings) {
      if (binding === undefined) throw "address binding invariant";
      addressStubs.add(binding.function);
    }
  }
  const included = new Uint8Array(checked.bindings.functions.length),
    children: number[][] = [];
  for (const fn of checked.bindings.functions) {
    if (fn === undefined)
      return { ok: false, error: "function graph contains a hole" };
    const parent = fn.parent;
    if (parent === undefined) continue;
    let family = children[parent];
    if (family === undefined) {
      family = [];
      children[parent] = family;
    }
    family.push(fn.id);
  }
  for (const entry of entries) {
    if (entry === undefined)
      return { ok: false, error: "entry list contains a hole" };
    expanded.push(entry);
    included[entry] = 1;
  }
  for (const id of options?.importedFunctions ?? []) {
    if (id === undefined) throw "imported function invariant";
    if (included[id] !== 1) {
      expanded.push(id);
      included[id] = 1;
    }
  }
  for (let i = 0; i < expanded.length; i++) {
    const owner = expanded[i];
    if (owner === undefined) throw "expanded function invariant";
    if (imported.has(owner) || addressStubs.has(owner)) continue;
    for (const child of children[owner] ?? []) {
      if (child === undefined) throw "child function invariant";
      if (included[child] !== 1) {
        included[child] = 1;
        expanded.push(child);
      }
    }
  }
  const numberToString = options?.numberToString,
    numberFromString = options?.numberFromString;
  return lowerEntries(checked, expanded, undefined, undefined, {
    target,
    maxBytes,
    lists: options?.lists,
    sets: options?.sets,
    maps: options?.maps,
    primitives: options?.primitives,
    bigints: options?.bigints,
    bigIntRepresentation: options?.bigIntRepresentation,
    realmTypeof: options?.realmTypeof,
    realmCall: options?.realmCall,
    realmConstruct: options?.realmConstruct,
    realmErrors: options?.realmErrors,
    nodeErrorTypes: options?.nodeErrorTypes,
    recordBindings: options?.recordBindings,
    recordTypes: options?.recordTypes,
    recordIdentity: options?.recordIdentity,
    signatureTypes: options?.signatureTypes,
    importedFunctions: options?.importedFunctions,
    functionAddressBindings: options?.functionAddressBindings,
    debug: options?.debug,
    ...(numberToString === undefined ? {} : { numberToString }),
    ...(numberFromString === undefined ? {} : { numberFromString }),
  });
}
interface Initializer {
  readonly function: number;
  readonly body: BlockStatement;
}
function lowerEntries(
  checked: CheckedClosures,
  entries: readonly number[],
  layoutInput: EnvironmentLayout | undefined,
  initializer: Initializer | undefined,
  recordOptions?: {
    target: TargetDataLayout;
    maxBytes: number;
    numberFromString?: number;
    numberToString?: number;
    lists: readonly ListRuntimeBinding[] | undefined;
    sets: readonly SetRuntimeBinding[] | undefined;
    maps: readonly MapRuntimeBinding[] | undefined;
    primitives: PrimitiveRuntime | undefined;
    bigints?: BigIntRuntime | undefined;
    bigIntRepresentation?: number | undefined;
    realmTypeof?: RealmTypeof | undefined;
    realmCall?: number | undefined;
    realmConstruct?: number | undefined;
    realmErrors?: RealmErrorSources | undefined;
    nodeErrorTypes?: NodeErrorTypes | undefined;
    recordBindings?: readonly RecordBinding[] | undefined;
    recordTypes?: boolean | undefined;
    recordIdentity?: RecordIdentityResolver | undefined;
    signatureTypes?: boolean | undefined;
    importedFunctions?: readonly number[] | undefined;
    functionAddressBindings?: readonly FunctionAddressBinding[] | undefined;
    debug?: boolean | undefined;
  },
): Result {
  const recordTarget = recordOptions,
    layout = layoutInput;
  const representations = createRepresentationMemo(checked);
  const imported = new Set(recordOptions?.importedFunctions ?? []);
  const addressStubs = new Set<number>();
  for (const binding of recordOptions?.functionAddressBindings ?? []) {
    if (binding === undefined) throw "address binding invariant";
    addressStubs.add(binding.function);
  }

  const abort = {},
    functions: FunctionIR[] = [],
    seen = new Uint8Array(checked.bindings.functions.length);
  let error = "";
  let fallback: LoweringFallback | undefined;
  function fail(message: string): never {
    error = message;
    throw abort;
  }
  function defaultInput(type: SourceScalarType): SourceScalarType {
    if (type === "boolean" || type === "optional-boolean")
      return "optional-boolean";
    if (type === "number" || type === "optional-number")
      return "optional-number";
    if (type === "string" || type === "optional-string")
      return "optional-string";
    if (
      [
        "reference",
        "optional-reference",
        "Uint8Array",
        "Uint16Array",
        "Uint32Array",
        "Float64Array",
      ].includes(type)
    )
      return "optional-reference";
    return fail(
      "default parameter requires numeric, boolean, string or reference encoding",
    );
  }
  const scalarEncodings: SourceScalarType[] = [],
    listElements = (recordTarget?.lists ?? []).map((l) => l.element),
    setElements = (recordTarget?.sets ?? []).map((s) => s.element);
  function scalar(id: number | undefined): SourceScalarType {
    if (id === undefined) return fail("missing checked type");
    const cached = scalarEncodings[id];
    if (cached !== undefined) return cached;
    const bigint = bigIntType(checked, id);
    let type: SourceScalarType | undefined =
      checked.types[id]?.kind === "ArrayBuffer"
        ? "reference"
        : bigint !== undefined
          ? bigint
          : layout === undefined
            ? entryType(
                checked,
                id,
                listElements,
                setElements,
                recordTarget?.maps ?? [],
              )
            : scalarType(checked, id);
    // A standalone null needs no allocated primitive wrapper. Preserve the
    // established primitive-runtime representation when that runtime is linked.
    if (
      checked.types[id]?.kind === "null" &&
      recordTarget?.primitives === undefined
    )
      type = "general";
    if (
      type === undefined ||
      (layout !== undefined &&
        type === "reference" &&
        checked.types[id]?.kind !== "ArrayBuffer" &&
        bigint === undefined)
    )
      fail(
        "type requires an unsupported native representation (type " +
          id +
          ", kind " +
          (checked.types[id]?.kind ?? "missing") +
          ", encoding " +
          (type ?? "none") +
          ", context " +
          (layout === undefined ? "entry" : "closure") +
          ")",
      );
    if (type === "primitive" && recordTarget?.primitives === undefined)
      fail("mixed primitive unions require primitive runtime bindings");
    scalarEncodings[id] = type;
    return type;
  }
  const span = { start: 0, end: 0 };
  try {
    const bodyByFunction: (ClosureBody | undefined)[] = [];
    for (const [id, body] of checked.bodies) bodyByFunction[id] = body;
    const bindingsByNode = createKeyIndex<Span, number>(syntaxHash);
    const bindingsByOwner: number[][] = [];
    for (const binding of checked.bindings.bindings) {
      if (binding === undefined) throw "binding graph invariant";
      if (bindingsByNode.get(binding.node) === undefined)
        bindingsByNode.set(binding.node, binding.id);
      const owner = binding.owner;
      if (owner !== undefined) {
        let owned = bindingsByOwner[owner];
        if (owned === undefined) {
          owned = [];
          bindingsByOwner[owner] = owned;
        }
        owned.push(binding.id);
      }
    }
    for (const alias of checked.bindings.aliases ?? []) {
      if (alias === undefined) throw "binding alias invariant";
      bindingsByNode.set(alias.node, alias.binding);
    }
    function bindingId(node: Span | undefined): number {
      return node === undefined ? -1 : (bindingsByNode.get(node) ?? -1);
    }
    // The checker publishes its relation system in lockstep with exactly
    // this graph; rebuilding one per lowering repeated the whole-table
    // identity and depth analysis. A replaced graph builds its own.
    const owned = checked.typeSystem;
    const validatedTypes: TypeResult<TypeSystem> =
      owned !== undefined && owned.types === checked.types
        ? { ok: true, value: owned.system }
        : createTypeSystem(checked.types);
    if (checked.module.statements.some((node) => node.kind === "class"))
      fail("typed class declarations require class construction lowering");
    if (!validatedTypes.ok) fail("invalid checked type graph");
    const viewError = incompatibleRepresentationView(
      checked,
      validatedTypes.value,
    );
    if (viewError !== undefined) fail(viewError);
    // Witness types of view-slot bindings cross into JavaScript as views:
    // their layouts hold a hidden view slot.
    const viewed = new Set<number>();
    for (const binding of recordTarget?.recordBindings ?? []) {
      if (binding === undefined) fail("record binding invariant");
      if (
        binding.operation !== "view-slot" &&
        binding.operation !== "set-view-slot"
      )
        continue;
      const witness = bodyByFunction[binding.function]?.parameters[0];
      const type =
        witness === undefined
          ? undefined
          : checked.bindingTypes[bindingId(witness)];
      if (type === undefined)
        fail("view slot binding requires a record witness");
      viewed.add(type);
    }
    const nodeErrorTypes = recordTarget?.nodeErrorTypes;
    const branded =
      nodeErrorTypes === undefined ? undefined : new Set<number>();
    if (nodeErrorTypes !== undefined && branded !== undefined)
      for (const type of [
        nodeErrorTypes.coded,
        nodeErrorTypes.type,
        nodeErrorTypes.range,
        nodeErrorTypes.system,
      ])
        if (type !== undefined) branded.add(type);
    const recordContracts: RecordContracts | undefined =
      recordTarget === undefined
        ? undefined
        : createRecordContracts(
            checked,
            recordTarget.target,
            recordTarget.maxBytes,
            fail,
            listElements,
            setElements,
            recordTarget.maps ?? [],
            validatedTypes.value,
            recordTarget.recordIdentity,
            viewed,
            branded,
          );
    const constants = new Map<number, number | boolean | string>();
    if (layout === undefined) {
      for (const statement of checked.module.statements) {
        if (statement === undefined) fail("module statement invariant");
        if (statement.kind !== "variable") continue;
        if (statement.mode !== "const")
          fail("mutable module state requires module initialization");
        for (const declaration of statement.declarations) {
          if (declaration === undefined) fail("module declaration invariant");
          const value = declaration.initializer;
          if (
            value === undefined ||
            (value.kind !== "number" &&
              value.kind !== "boolean" &&
              value.kind !== "string")
          )
            fail("module initializer requires runtime evaluation");
          const binding = checked.bindings.bindings[bindingId(declaration)];
          if (binding === undefined) fail("module binding invariant");
          constants.set(binding.id, value.value);
        }
      }
    }
    const direct = directFunctions(checked),
      targetIds: (number | undefined)[] = [];
    for (let index = 0; index < entries.length; index++) {
      const id = entries[index];
      if (id === undefined) fail("entry function invariant");
      targetIds[id] = index;
    }
    // A nested direct function may capture only other direct functions
    // (themselves included), which need no environment; removing one can
    // invalidate the functions that capture it, so iterate to a fixpoint.
    if (recordTarget !== undefined && layout === undefined)
      for (let changed = true; changed;) {
        changed = false;
        for (let binding = 0; binding < direct.length; binding++) {
          const id = direct[binding];
          if (id === undefined) continue;
          const fn = checked.bindings.functions[id];
          if (fn === undefined || fn.parent === undefined) continue;
          let environment =
            checked.bindings.bindings[binding]?.scope !==
            checked.bindings.functions[fn.parent]?.scope;
          for (const capture of fn.captures)
            if (capture === undefined || direct[capture.binding] === undefined)
              environment = true;
          if (environment) {
            direct[binding] = undefined;
            changed = true;
          }
        }
      }
    const signatures: FunctionSignature[] = entries.map((id) => {
      const body = bodyByFunction[id];
      if (body === undefined) fail("unknown source function");
      return {
        parameters: body.parameters.map((p) => {
          const b = checked.bindings.bindings[bindingId(p)];
          const type = scalar(
            b === undefined ? undefined : checked.bindingTypes[b.id],
          );
          if (p.initializer !== undefined) {
            if (layout !== undefined)
              fail("default parameters require managed module entries");
            return defaultInput(type);
          }
          return type;
        }),
        returnType:
          initializer?.function === id
            ? "boolean"
            : checked.voidValueReturns?.has(id) === true
              ? "general"
              : checked.types[body.result]?.kind === "void" ||
                  checked.types[body.result]?.kind === "never"
                ? "void"
                : scalar(body.result),
      };
    });
    // The first signature with a given contract that is not an imported
    // entry's, so interning a callback contract is one lookup instead of a
    // scan of every signature. Signatures are only appended, never changed.
    function signatureKey(
      parameters: readonly ScalarType[],
      result: FunctionSignature["returnType"],
    ): string {
      return result + "(" + parameters.join(",") + ")";
    }
    const signatureIds = new Map<string, number>();
    for (let index = 0; index < signatures.length; index++) {
      const signature = signatures[index];
      if (signature === undefined || imported.has(entries[index] ?? -1))
        continue;
      const key = signatureKey(signature.parameters, signature.returnType);
      if (!signatureIds.has(key)) signatureIds.set(key, index);
    }
    const semanticWitnesses =
      recordOptions?.signatureTypes === true
        ? new Uint32Array(checked.types.length)
        : undefined;
    // Indirect calls use function IDs as ABI contracts. Intern missing contracts
    // once; their trap bodies are never dispatched by an indirect call.
    function callbackSignature(
      parameters: readonly ScalarType[],
      result: FunctionSignature["returnType"],
      type: number | undefined,
    ): number {
      if (semanticWitnesses !== undefined) {
        if (
          type === undefined ||
          !Number.isInteger(type) ||
          type < 0 ||
          type >= checked.types.length ||
          checked.types[type]?.kind !== "function"
        )
          fail("semantic callback witness requires a checked function type");
        const existing = semanticWitnesses[type] ?? 0;
        if (existing !== 0) return existing - 1;
        const id = signatures.length;
        signatures.push({ parameters, returnType: result });
        semanticWitnesses[type] = id + 1;
        return id;
      }
      const key = signatureKey(parameters, result),
        found = signatureIds.get(key);
      if (found !== undefined) return found;
      const id = signatures.length;
      signatures.push({ parameters, returnType: result });
      signatureIds.set(key, id);
      return id;
    }
    const voidResultsBySignature = new Map<number, readonly number[]>();
    function voidCallResults(target: number): readonly number[] {
      const known = voidResultsBySignature.get(target);
      if (known !== undefined) return known;
      if (semanticWitnesses !== undefined)
        fail(
          "observing a void callback result across managed signatures requires a result adapter",
        );
      const signature = signatures[target];
      if (signature === undefined) throw "void callback signature invariant";
      const parameters = signature.parameters;
      const results = new Set<FunctionSignature["returnType"]>();
      for (const candidate of signatures) {
        if (candidate === undefined) throw "void result signature invariant";
        if (
          candidate.parameters.length === parameters.length &&
          candidate.parameters.every(
            (type, index) => type === parameters[index],
          )
        )
          results.add(candidate.returnType);
      }
      const witnesses: number[] = [];
      for (const result of results) {
        if (result === undefined) throw "void callback result invariant";
        witnesses.push(signatures.length);
        // The stub supplies an environment-free signature address for the
        // guard. Dispatch always calls the closure's own entry.
        signatures.push({ parameters, returnType: result });
      }
      voidResultsBySignature.set(target, witnesses);
      return witnesses;
    }
    function parameterType(id: number, index: number): number | undefined {
      const parameter = bodyByFunction[id]?.parameters[index],
        binding = checked.bindings.bindings[bindingId(parameter)];
      return binding === undefined
        ? undefined
        : checked.bindingTypes[binding.id];
    }
    const primitiveSources = recordTarget?.primitives;
    const primitiveRepresentation =
      primitiveSources === undefined
        ? undefined
        : bodyByFunction[primitiveSources.fromUndefined]?.result;
    const primitiveValidator =
      primitiveSources === undefined
        ? undefined
        : runtimeHelpers("primitive", primitiveSources.fromUndefined, []);
    function primitiveHelper(
      source: number,
      parameters: readonly SourceScalarType[],
      result: SourceScalarType,
    ): number {
      const helper = checked.bindings.functions[source];
      if (
        primitiveValidator === undefined ||
        helper === undefined ||
        helper.parent !== undefined ||
        helper.captures.length !== 0
      )
        fail(
          "primitive runtime helper has an incompatible signature or is not included",
        );
      const target = primitiveValidator(source, parameters, result);
      if (!validatedTypes.ok || primitiveRepresentation === undefined)
        fail("invalid primitive representation contract");
      const system = validatedTypes.value;
      const contracts: number[] = [];
      const seenContracts = new Set<number>();
      function presentContract(id: number): void {
        if (seenContracts.has(id)) return;
        seenContracts.add(id);
        const type = checked.types[id];
        if (type?.kind === "undefined") return;
        if (type?.kind === "union") {
          for (const member of type.members) {
            if (member === undefined)
              throw "primitive union contract invariant";
            presentContract(member);
          }
        } else contracts.push(id);
      }
      for (let i = 0; i < parameters.length; i++)
        if (
          parameters[i] === "reference" ||
          parameters[i] === "optional-reference"
        ) {
          const type = parameterType(source, i);
          if (type === undefined) fail("missing primitive receiver contract");
          if (parameters[i] === "optional-reference") presentContract(type);
          else contracts.push(type);
        }
      if (result === "reference") {
        const type = bodyByFunction[source]?.result;
        if (type === undefined) fail("missing primitive result contract");
        contracts.push(type);
      }
      if (
        !contracts.every(
          (type) =>
            system.assignable(type, primitiveRepresentation) &&
            system.assignable(primitiveRepresentation, type),
        )
      )
        fail("primitive runtime representation mismatch");
      return target;
    }
    const primitives: PrimitiveRuntime | undefined =
      primitiveSources === undefined
        ? undefined
        : {
            fromNull: primitiveHelper(
              primitiveSources.fromNull,
              [],
              "reference",
            ),
            isNullish: primitiveHelper(
              primitiveSources.isNullish,
              ["reference"],
              "boolean",
            ),
            fromUndefined: primitiveHelper(
              primitiveSources.fromUndefined,
              [],
              "reference",
            ),
            fromNumber: primitiveHelper(
              primitiveSources.fromNumber,
              ["number"],
              "reference",
            ),
            fromBoolean: primitiveHelper(
              primitiveSources.fromBoolean,
              ["boolean"],
              "reference",
            ),
            fromString: primitiveHelper(
              primitiveSources.fromString,
              ["string"],
              "reference",
            ),
            fromOptionalNumber: primitiveHelper(
              primitiveSources.fromOptionalNumber,
              ["optional-number"],
              "reference",
            ),
            fromOptionalString: primitiveHelper(
              primitiveSources.fromOptionalString,
              ["optional-string"],
              "reference",
            ),
            fromOptionalBoolean: primitiveHelper(
              primitiveSources.fromOptionalBoolean,
              ["optional-boolean"],
              "reference",
            ),
            fromOptionalBox: primitiveHelper(
              primitiveSources.fromOptionalBox,
              ["optional-reference"],
              "reference",
            ),
            readNumber: primitiveHelper(
              primitiveSources.readNumber,
              ["reference"],
              "number",
            ),
            readBoolean: primitiveHelper(
              primitiveSources.readBoolean,
              ["reference"],
              "boolean",
            ),
            readString: primitiveHelper(
              primitiveSources.readString,
              ["reference"],
              "string",
            ),
            readOptionalNumber: primitiveHelper(
              primitiveSources.readOptionalNumber,
              ["reference"],
              "optional-number",
            ),
            readOptionalString: primitiveHelper(
              primitiveSources.readOptionalString,
              ["reference"],
              "optional-string",
            ),
            readOptionalBoolean: primitiveHelper(
              primitiveSources.readOptionalBoolean,
              ["reference"],
              "optional-boolean",
            ),
            kindOf: primitiveHelper(
              primitiveSources.kindOf,
              ["reference"],
              "string",
            ),
            truthy: primitiveHelper(
              primitiveSources.truthy,
              ["reference"],
              "boolean",
            ),
            canonicalKey: primitiveHelper(
              primitiveSources.canonicalKey,
              ["reference"],
              "reference",
            ),
            canonicalOptionalNumber: primitiveHelper(
              primitiveSources.canonicalOptionalNumber,
              ["optional-number"],
              "optional-number",
            ),
            strictEqual: primitiveHelper(
              primitiveSources.strictEqual,
              ["reference", "reference"],
              "boolean",
            ),
          };
    /** The BigInt helpers, validated once a checked type mentions bigint:
     * every reference parameter and result must be exactly the record the
     * literal helper returns (js-runtime's BigIntValue). */
    const bigIntSources = recordTarget?.bigints;
    const bigints: BigIntRuntime | undefined =
      bigIntSources === undefined || !usesBigInt(checked)
        ? undefined
        : validateBigIntRuntime(bigIntSources);
    function validateBigIntRuntime(sources: BigIntRuntime): BigIntRuntime {
      const representation = bodyByFunction[sources.literal]?.result;
      if (
        !validatedTypes.ok ||
        representation === undefined ||
        checked.types[representation]?.kind !== "object"
      )
        fail("BigInt runtime requires a BigIntValue record representation");
      const system = validatedTypes.value;
      function same(type: number | undefined): boolean {
        return (
          type !== undefined &&
          representation !== undefined &&
          system.assignable(type, representation) &&
          system.assignable(representation, type)
        );
      }
      function helper(
        source: number,
        parameters: readonly SourceScalarType[],
        result: SourceScalarType,
      ): number {
        const target = targetIds[source],
          signature = target === undefined ? undefined : signatures[target],
          binding = checked.bindings.functions[source];
        if (
          target === undefined ||
          signature === undefined ||
          binding === undefined ||
          binding.parent !== undefined ||
          binding.captures.length !== 0 ||
          signature.returnType !== result ||
          signature.parameters.length !== parameters.length ||
          signature.parameters.some((p, i) => p !== parameters[i])
        )
          fail(
            "BigInt runtime helper " +
              String(source) +
              " is missing or has an incompatible signature",
          );
        for (let i = 0; i < parameters.length; i++)
          if (parameters[i] === "reference" && !same(parameterType(source, i)))
            fail("BigInt runtime parameter representation mismatch");
        if (result === "reference" && !same(bodyByFunction[source]?.result))
          fail("BigInt runtime result representation mismatch");
        return target;
      }
      const pair = (source: number): number =>
        helper(source, ["reference", "reference"], "reference");
      const unary = (source: number): number =>
        helper(source, ["reference"], "reference");
      const binary = sources.binary;
      return {
        literal: helper(sources.literal, ["string"], "reference"),
        binary: {
          "+": pair(binary["+"]),
          "-": pair(binary["-"]),
          "*": pair(binary["*"]),
          "/": pair(binary["/"]),
          "%": pair(binary["%"]),
          "**": pair(binary["**"]),
          "&": pair(binary["&"]),
          "|": pair(binary["|"]),
          "^": pair(binary["^"]),
          "<<": pair(binary["<<"]),
          ">>": pair(binary[">>"]),
        },
        negate: unary(sources.negate),
        not: unary(sources.not),
        compare: helper(sources.compare, ["reference", "reference"], "number"),
        compareNumber: helper(
          sources.compareNumber,
          ["reference", "number"],
          "number",
        ),
        equal: helper(sources.equal, ["reference", "reference"], "boolean"),
        truthy: helper(sources.truthy, ["reference"], "boolean"),
        toString: helper(sources.toString, ["reference"], "string"),
        toNumber: helper(sources.toNumber, ["reference"], "number"),
        fromNumber: helper(sources.fromNumber, ["number"], "reference"),
        fromBoolean: helper(sources.fromBoolean, ["boolean"], "reference"),
        asWidth: helper(
          sources.asWidth,
          ["number", "reference", "boolean"],
          "reference",
        ),
      };
    }
    const realmTypeof = recordTarget?.realmTypeof;
    const realmErrorSources = recordTarget?.realmErrors;
    function generalRuntimeHelper(
      source: number,
      params: readonly ScalarType[],
      message: string,
    ): number {
      const target = targetIds[source];
      const signature = target === undefined ? undefined : signatures[target];
      if (
        target === undefined ||
        signature?.returnType !== "general" ||
        signature.parameters.length !== params.length ||
        params.some((type, index) => type !== signature.parameters[index]) ||
        checked.bindings.functions[source]?.parent !== undefined ||
        checked.bindings.functions[source]?.captures.length !== 0
      )
        fail(message);
      return target;
    }
    function errorRecord(source: number): number {
      const contracts = recordContracts;
      if (contracts === undefined) fail("missing mixed native error layouts");
      const witness = bodyByFunction[source]?.parameters[0];
      const type = checked.bindingTypes[bindingId(witness)];
      const record = type === undefined ? undefined : contracts.forType(type);
      if (record === undefined || contracts.viewSlot(record) !== 2)
        fail("native error layout requires a traced view slot");
      const fields = contracts.records[record]?.fields;
      const message = fields?.[0];
      if (
        message === undefined ||
        message.type !== "string" ||
        message.offset !== recordHeaderBytes ||
        fields?.[1]?.type !== "boolean"
      )
        fail("native error layout requires a message and presence flag");
      return record;
    }
    const realmErrors: RealmErrorRuntime | undefined =
      realmErrorSources === undefined
        ? undefined
        : {
            view: generalRuntimeHelper(
              realmErrorSources.view,
              ["general"],
              "invalid mixed native error helper signature",
            ),
            operation: generalRuntimeHelper(
              realmErrorSources.operation,
              ["general", "string"],
              "invalid mixed native error helper signature",
            ),
            error: errorRecord(realmErrorSources.error),
            typeError: errorRecord(realmErrorSources.typeError),
            rangeError: errorRecord(realmErrorSources.rangeError),
            applies: realmErrorSources.applies,
          };
    function nodeErrorRecord(type: number | undefined): number | undefined {
      return type === undefined ? undefined : recordContracts?.forType(type);
    }
    const nodeErrors =
      nodeErrorTypes === undefined
        ? undefined
        : {
            coded: nodeErrorRecord(nodeErrorTypes.coded),
            type: nodeErrorRecord(nodeErrorTypes.type),
            range: nodeErrorRecord(nodeErrorTypes.range),
            system: nodeErrorRecord(nodeErrorTypes.system),
            info: nodeErrorRecord(nodeErrorTypes.info),
          };
    const flowStorage =
      realmErrors === undefined ? undefined : planFlowPropertyStorage(checked);
    function bindingScalar(binding: number): SourceScalarType {
      return flowStorage?.bindings.has(binding) === true
        ? "general"
        : scalar(checked.bindingTypes[binding]);
    }
    function realmTypeofTarget(span: IRSpan): number | undefined {
      if (realmTypeof === undefined || !realmTypeof.applies(span))
        return undefined;
      const target = targetIds[realmTypeof.function];
      const signature = target === undefined ? undefined : signatures[target];
      if (
        target === undefined ||
        signature?.returnType !== "string" ||
        signature.parameters.length !== 1 ||
        signature.parameters[0] !== "general" ||
        checked.bindings.functions[realmTypeof.function]?.parent !==
          undefined ||
        checked.bindings.functions[realmTypeof.function]?.captures.length !== 0
      )
        fail("realm typeof helper requires (unknown) => string");
      return target;
    }
    function realmCallTarget(): number | undefined {
      const source = recordTarget?.realmCall;
      if (source === undefined) return undefined;
      const target = generalRuntimeHelper(
        source,
        ["general", "general", "reference"],
        "invalid realm call helper signature",
      );
      const argumentsType = parameterType(source, 2);
      const argumentsList = checked.types[argumentsType ?? -1];
      if (
        argumentsList?.kind !== "array" ||
        checked.types[argumentsList.element]?.kind !== "unknown"
      )
        fail("realm call helper requires a general argument list");
      return target;
    }
    /** The BigIntValue record layout, planned on first use. */
    function bigIntRecord(): number | undefined {
      const source = recordTarget?.bigIntRepresentation;
      const type =
        source === undefined ? undefined : bodyByFunction[source]?.result;
      return type === undefined ? undefined : recordContracts?.forType(type);
    }
    function numberFormatter(): number {
      const source = recordTarget?.numberToString;
      const target = source === undefined ? undefined : targetIds[source];
      const signature = target === undefined ? undefined : signatures[target];
      const parameter =
        source === undefined ? undefined : parameterType(source, 0);
      const helper =
        source === undefined ? undefined : checked.bindings.functions[source];
      if (
        target === undefined ||
        signature?.returnType !== "string" ||
        signature.parameters.length !== 1 ||
        signature.parameters[0] !== "number" ||
        parameter === undefined ||
        checked.types[parameter]?.kind !== "number" ||
        helper === undefined ||
        helper.parent !== undefined ||
        helper.captures.length !== 0
      )
        fail(
          "Number formatting requires an included (number) => string runtime helper",
        );
      return target;
    }
    function runtimeHelpers(
      name: string,
      create: number,
      receivers: readonly number[],
    ): (
      id: number,
      parameters: readonly ScalarType[],
      result: ScalarType | "void",
    ) => number {
      const runtimeTypes = validatedTypes,
        representation = bodyByFunction[create]?.result;
      if (
        !runtimeTypes.ok ||
        representation === undefined ||
        checked.types[representation]?.kind !== "object"
      )
        fail(name + " runtime requires an object representation");
      const runtimeSystem = runtimeTypes.value;
      for (const id of receivers) {
        if (id === undefined) fail(name + " runtime receiver invariant");
        const type = parameterType(id, 0);
        if (
          type === undefined ||
          !runtimeSystem.assignable(representation, type) ||
          !runtimeSystem.assignable(type, representation)
        )
          fail(name + " runtime receiver representation mismatch");
      }
      function helper(
        id: number,
        parameters: readonly ScalarType[],
        result: ScalarType | "void",
      ): number {
        const target = targetIds[id],
          signature = target === undefined ? undefined : signatures[target];
        if (
          target === undefined ||
          signature === undefined ||
          signature.returnType !== result ||
          signature.parameters.length !== parameters.length ||
          signature.parameters.some((p, i) => p !== parameters[i])
        )
          return fail(
            name +
              " runtime signature mismatch for " +
              String(id) +
              ": expected (" +
              parameters.join(",") +
              ") => " +
              result +
              "; received " +
              (signature === undefined
                ? "missing"
                : "(" +
                  signature.parameters.join(",") +
                  ") => " +
                  signature.returnType),
          );
        // Physical string/number encodings also cover literals. A helper must
        // accept every value promised by the source operation, not just a literal.
        for (let i = 0; i < parameters.length; i++) {
          const expected = parameters[i];
          const primitive =
            expected === "string" || expected === "optional-string"
              ? "string"
              : expected === "number" || expected === "optional-number"
                ? "number"
                : expected === "boolean" || expected === "optional-boolean"
                  ? "boolean"
                  : undefined;
          const nullable =
            expected === "optional-string" ||
            expected === "optional-boolean" ||
            expected === "optional-number" ||
            expected === "optional-reference";
          if (primitive === undefined && !nullable) continue;
          const actual = parameterType(id, i);
          const broad =
            primitive === undefined
              ? undefined
              : checked.types.findIndex(
                  (t) => t !== undefined && t.kind === primitive,
                );
          const absent = checked.types.findIndex(
            (t) => t !== undefined && t.kind === "undefined",
          );
          if (
            actual === undefined ||
            (broad !== undefined &&
              (broad < 0 || !runtimeSystem.assignable(broad, actual))) ||
            (nullable &&
              (absent < 0 || !runtimeSystem.assignable(absent, actual)))
          )
            fail(name + " runtime parameter contract mismatch");
        }
        return target;
      }
      return helper;
    }
    function validateCollectionElement(
      inputElement: CollectionElement,
      writes: readonly { readonly function: number; readonly index: number }[],
      read?: number,
      erasedRecords: boolean = false,
    ): void {
      const element = inputElement;
      if (typeof element !== "number") return;
      const objectType = element;
      const system = validatedTypes;
      if (
        !system.ok ||
        ![
          "Uint8Array",
          "Uint16Array",
          "Uint32Array",
          "Float64Array",
          "reference",
          "optional-reference",
          "primitive",
          "general",
          "optional-number",
          "optional-string",
          "boolean",
          "optional-boolean",
        ].includes(
          entryType(
            checked,
            element,
            listElements,
            setElements,
            recordTarget?.maps ?? [],
          ) ?? "",
        )
      )
        fail(
          "collection runtime requires a supported registered element encoding",
        );
      // A binding vouching for erased elements accepts a helper specialized
      // for another element of the same encoding class.
      const erased = erasedRecords
        ? listElementClass(checked, element)
        : undefined;
      for (const write of writes) {
        if (write === undefined) fail("write array invariant");
        const actual = parameterType(write.function, write.index);
        if (
          actual === undefined ||
          !(
            system.value.assignable(element, actual) ||
            (erased !== undefined &&
              listElementClass(checked, presentListElement(checked, actual)) ===
                erased)
          )
        )
          fail("collection runtime parameter contract mismatch");
      }
      if (read === undefined) return;
      const result = bodyByFunction[read]?.result;
      const seen = new Set<number>();
      function validRead(id: number): boolean {
        if (seen.has(id)) return true;
        seen.add(id);
        if (erased !== undefined && listElementClass(checked, id) === erased)
          return true;
        const type = checked.types[id];
        if (type?.kind === "union") return type.members.every(validRead);
        return (
          type?.kind === "undefined" ||
          (system.ok && system.value.assignable(id, objectType))
        );
      }
      if (result === undefined || !validRead(result))
        fail("collection runtime read contract mismatch");
    }
    const lists: ListRuntimeBinding[] = [];
    for (const binding of recordTarget?.lists ?? []) {
      if (binding === undefined) fail("binding array invariant");
      const element = binding.element;
      if (lists.some((l) => l.element === element))
        fail("duplicate list runtime element binding");
      const source = binding.runtime;
      const encoding: ScalarType =
        typeof element === "number" ? scalar(element) : element;
      const optionalEncoding: ScalarType =
        encoding === "boolean" || encoding === "optional-boolean"
          ? "optional-boolean"
          : encoding === "number"
            ? "optional-number"
            : encoding === "string"
              ? "optional-string"
              : encoding === "primitive" || encoding === "general"
                ? encoding
                : "optional-reference";
      validateCollectionElement(
        element,
        [
          { function: source.write, index: 2 },
          { function: source.push, index: 1 },
        ],
        source.read,
        binding.erasedRecords === true,
      );
      const sort = source.sort,
        has = source.has,
        remove = source.delete,
        resize = source.resize;
      const receivers = [source.read, source.write, source.push, source.length];
      for (const receiver of [sort, has, remove, resize]) {
        if (receiver !== undefined) receivers.push(receiver);
      }
      const helper = runtimeHelpers(
        encoding + " list",
        source.create,
        receivers,
      );
      if (sort !== undefined) {
        const system = validatedTypes;
        if (!system.ok) fail("sort type system invariant");
        const representation = bodyByFunction[source.create]?.result;
        const returned = bodyByFunction[sort]?.result;
        const comparatorId = parameterType(sort, 1);
        const comparator =
          comparatorId === undefined ? undefined : checked.types[comparatorId];
        const elementType =
          typeof element === "number"
            ? element
            : checked.types.findIndex(
                (t) => t !== undefined && t.kind === element,
              );
        const numberType = checked.types.findIndex(
          (t) => t !== undefined && t.kind === "number",
        );
        if (
          representation === undefined ||
          returned === undefined ||
          !system.value.assignable(representation, returned) ||
          !system.value.assignable(returned, representation)
        )
          fail("sort runtime result representation mismatch");
        if (
          comparator?.kind !== "function" ||
          comparator.parameters.length !== 2 ||
          elementType < 0 ||
          numberType < 0 ||
          !system.value.assignable(numberType, comparator.result) ||
          !system.value.assignable(comparator.result, numberType) ||
          comparator.parameters.some(
            (p) =>
              !system.value.assignable(p, elementType) ||
              !system.value.assignable(elementType, p),
          )
        )
          fail("sort runtime comparator contract mismatch");
      }
      lists.push({
        element: element,
        runtime: {
          create: helper(source.create, ["number"], "reference"),
          ...(sort === undefined
            ? {}
            : {
                sort: helper(sort, ["reference", "reference"], "reference"),
              }),
          read: helper(source.read, ["reference", "number"], optionalEncoding),
          write: helper(
            source.write,
            ["reference", "number", optionalEncoding],
            "void",
          ),
          push: helper(source.push, ["reference", optionalEncoding], "number"),
          length: helper(source.length, ["reference"], "number"),
          ...(has === undefined
            ? {}
            : { has: helper(has, ["reference", "number"], "boolean") }),
          ...(remove === undefined
            ? {}
            : {
                delete: helper(remove, ["reference", "number"], "boolean"),
              }),
          ...(resize === undefined
            ? {}
            : {
                resize: helper(resize, ["reference", "number"], "void"),
              }),
        },
      });
    }
    const sets: SetRuntimeBinding[] = [];
    for (const binding of recordTarget?.sets ?? []) {
      if (binding === undefined) fail("binding array invariant");
      if (sets.some((s) => s.element === binding.element))
        fail("duplicate set runtime element binding");
      const source = binding.runtime;
      const sourceElement = binding.element;
      const element: ScalarType =
        typeof sourceElement === "number"
          ? scalar(sourceElement)
          : sourceElement;
      if (element === "optional-number" && primitives === undefined)
        fail(
          "optional numeric collection keys require primitive runtime bindings",
        );
      validateCollectionElement(
        sourceElement,
        [
          { function: source.has, index: 1 },
          { function: source.add, index: 1 },
          { function: source.delete, index: 1 },
        ],
        source.iterator?.read,
      );
      const sourceIterator = source.iterator;
      const receivers = [
        source.has,
        source.add,
        source.delete,
        source.clear,
        source.size,
      ];
      if (sourceIterator !== undefined) receivers.push(sourceIterator.create);
      const sourceClone = source.clone;
      if (sourceClone !== undefined) receivers.push(sourceClone);
      const helper = runtimeHelpers(element + " set", source.create, receivers);
      let clone: number | undefined;
      if (sourceClone !== undefined) {
        // Validate the returned object representation as well as the receiver.
        const contract = runtimeHelpers(element + " set clone", sourceClone, [
          source.has,
        ]);
        clone = contract(sourceClone, ["reference"], "reference");
      }
      let iterator: SetRuntimeBinding["runtime"]["iterator"];
      if (sourceIterator !== undefined) {
        const contract = runtimeHelpers(
          element + " set iterator",
          sourceIterator.create,
          [sourceIterator.advance, sourceIterator.read],
        );
        iterator = {
          create: contract(sourceIterator.create, ["reference"], "reference"),
          advance: contract(sourceIterator.advance, ["reference"], "boolean"),
          read: contract(sourceIterator.read, ["reference"], element),
        };
      }
      sets.push({
        element: binding.element,
        runtime: {
          create: helper(source.create, [], "reference"),
          has: helper(source.has, ["reference", element], "boolean"),
          add: helper(source.add, ["reference", element], "boolean"),
          delete: helper(source.delete, ["reference", element], "boolean"),
          clear: helper(source.clear, ["reference"], "void"),
          size: helper(source.size, ["reference"], "number"),
          ...(clone === undefined ? {} : { clone }),
          ...(iterator === undefined ? {} : { iterator }),
        },
      });
    }
    const maps: MapRuntimeBinding[] = [];
    for (const binding of recordTarget?.maps ?? []) {
      if (binding === undefined) fail("binding array invariant");
      if (maps.some((m) => m.key === binding.key && m.value === binding.value))
        fail("duplicate map runtime key binding");
      const source = binding.runtime;
      const keyElement = binding.key,
        valueElement = binding.value;
      const key: ScalarType =
        typeof keyElement === "number" ? scalar(keyElement) : keyElement;
      const value: ScalarType =
        typeof valueElement === "number" ? scalar(valueElement) : valueElement;
      const erasedMap = binding.erasedRecords === true;
      validateCollectionElement(
        binding.key,
        [source.get, source.has, source.set, source.delete].map((id) => ({
          function: id,
          index: 1,
        })),
        undefined,
        erasedMap,
      );
      validateCollectionElement(
        binding.value,
        [{ function: source.set, index: 2 }],
        source.get,
        erasedMap,
      );
      const sourceIterator = source.iterator;
      if (sourceIterator !== undefined) {
        validateCollectionElement(
          binding.key,
          [{ function: source.set, index: 1 }],
          sourceIterator.key,
          erasedMap,
        );
        validateCollectionElement(
          binding.value,
          [{ function: source.set, index: 2 }],
          sourceIterator.value,
          erasedMap,
        );
      }
      const receivers = [
        source.get,
        source.has,
        source.set,
        source.delete,
        source.clear,
        source.size,
      ];
      if (sourceIterator !== undefined) receivers.push(sourceIterator.create);
      const helper = runtimeHelpers(key + " map", source.create, receivers);
      let iterator: MapRuntimeBinding["runtime"]["iterator"];
      if (sourceIterator !== undefined) {
        const contract = runtimeHelpers(
          key + " map iterator",
          sourceIterator.create,
          [sourceIterator.advance, sourceIterator.key, sourceIterator.value],
        );
        iterator = {
          create: contract(sourceIterator.create, ["reference"], "reference"),
          advance: contract(sourceIterator.advance, ["reference"], "boolean"),
          key: contract(sourceIterator.key, ["reference"], key),
          value: contract(sourceIterator.value, ["reference"], value),
        };
      }
      if (key === "optional-number" && primitives === undefined)
        fail(
          "optional numeric collection keys require primitive runtime bindings",
        );
      maps.push({
        key: binding.key,
        value: binding.value,
        runtime: {
          create: helper(source.create, [], "reference"),
          get: helper(
            source.get,
            ["reference", key],
            value === "primitive" || value === "general"
              ? value
              : value === "reference" || value === "optional-reference"
                ? "optional-reference"
                : value === "string" || value === "optional-string"
                  ? "optional-string"
                  : value === "boolean" || value === "optional-boolean"
                    ? "optional-boolean"
                    : "optional-number",
          ),
          has: helper(source.has, ["reference", key], "boolean"),
          set: helper(source.set, ["reference", key, value], "boolean"),
          delete: helper(source.delete, ["reference", key], "boolean"),
          clear: helper(source.clear, ["reference"], "void"),
          size: helper(source.size, ["reference"], "number"),
          ...(iterator === undefined ? {} : { iterator }),
        },
      });
    }
    const environment: Environment | undefined =
      layout === undefined
        ? undefined
        : {
            byteLength: layout.layout.size,
            cells: layout.cells.map((c) => {
              const b = checked.bindings.bindings[c.binding];
              if (
                b === undefined ||
                b.scope !== layout.scope ||
                b.mutable !== c.mutable
              )
                fail("layout does not match checked bindings");
              const type = scalar(checked.bindingTypes[c.binding]);
              if (
                c.storage.size !== scalarByteLength(type) ||
                c.storage.alignment !== 8
              )
                fail("layout does not use scalar cell encodings");
              const borrowed: { readonly borrowed?: true } = [
                "Uint8Array",
                "Uint16Array",
                "Uint32Array",
                "Float64Array",
              ].includes(type)
                ? { borrowed: true }
                : {};
              return {
                type,
                ...borrowed,
                stateOffset: c.stateOffset,
                valueOffset: c.valueOffset,
                mutable: c.mutable,
              };
            }),
          };
    const ownedCells: (number | undefined)[] = [],
      capturePlan = planCaptures(checked),
      valueCaptures = capturePlan.values;
    const ownedFunctions = new Map<
      number,
      { record: number; bindings: readonly number[] }
    >();
    if (recordContracts !== undefined && layout === undefined) {
      for (const binding of checked.bindings.bindings) {
        if (binding === undefined) fail("binding array invariant");
        const owner = binding.owner;
        if (
          !binding.captured ||
          owner === undefined ||
          targetIds[owner] === undefined ||
          imported.has(owner) ||
          addressStubs.has(owner) ||
          direct[binding.id] !== undefined ||
          constants.has(binding.id)
        )
          continue;
        const scope = checked.bindings.scopes[binding.scope];
        if (
          scope?.kind !== "function" &&
          scope?.kind !== "block" &&
          scope?.kind !== "for"
        )
          fail("unsupported owned capture scope");
        const type = bindingScalar(binding.id);
        // Environment fields below occupy one word. Keep wider carriers in
        // cells; traced pointers retain their ordinary descriptor field type.
        if (valueCaptures[binding.id] === 1 && scalarByteLength(type) !== 8)
          valueCaptures[binding.id] = 0;
        ownedCells[binding.id] = recordContracts.append({
          byteLength: alignAllocation(
            recordHeaderBytes + scalarByteLength(type) + 1,
          ),
          fields: [
            {
              offset: recordHeaderBytes,
              stateOffset: recordHeaderBytes + scalarByteLength(type),
              type,
              mutable: binding.mutable,
            },
          ],
        });
      }
      for (const sourceId of entries) {
        if (sourceId === undefined) fail("sourceId array invariant");
        if (imported.has(sourceId) || addressStubs.has(sourceId)) continue;
        const fn = checked.bindings.functions[sourceId];
        if (fn === undefined) continue;
        const bindings = fn.captures
          .map((c) => c.binding)
          .filter((id) => direct[id] === undefined && !constants.has(id));
        if (bindings.length === 0) continue;
        for (const binding of bindings) {
          if (binding === undefined || ownedCells[binding] === undefined)
            fail("owned capture requires an included lexical owner");
        }
        ownedFunctions.set(sourceId, {
          bindings,
          record: recordContracts.append({
            byteLength: alignAllocation(
              recordHeaderBytes + bindings.length * 8,
            ),
            fields: bindings.map((binding, i) => ({
              offset: recordHeaderBytes + i * 8,
              type:
                valueCaptures[binding] === 1
                  ? scalar(checked.bindingTypes[binding])
                  : "reference",
              mutable: false,
            })),
          }),
        });
      }
    }
    // Source node identity is shared by all function adaptations. Build this
    // once rather than allocating module-wide reference tables per function.
    const referenceBindings = createKeyIndex<Expression, number>(syntaxHash);
    for (const reference of checked.bindings.references) {
      if (reference === undefined) fail("reference graph invariant");
      const binding = reference.binding;
      if (binding !== undefined) referenceBindings.set(reference.node, binding);
    }
    for (const sourceId of entries) {
      if (sourceId === undefined) fail("sourceId array invariant");
      if (seen[sourceId] === 1) fail("duplicate entry");
      seen[sourceId] = 1;
      const fn = checked.bindings.functions[sourceId],
        body = bodyByFunction[sourceId];
      const initializing = initializer?.function === sourceId;
      if (
        fn === undefined ||
        body === undefined ||
        (!initializing &&
          fn.captures.length === 0 &&
          (layout === undefined
            ? recordTarget === undefined && fn.parent !== undefined
            : fn.parent !== undefined &&
              checked.bindings.functions[fn.parent]?.scope !== layout.scope))
      )
        fail("entry must be a checked capturing function");
      const sourceOwner = body.node;
      if (imported.has(sourceId) || addressStubs.has(sourceId)) {
        if (
          fn.parent !== undefined ||
          fn.receiverBinding !== undefined ||
          fn.captures.some(
            (capture) =>
              capture === undefined ||
              (direct[capture.binding] === undefined &&
                !constants.has(capture.binding)),
          )
        )
          fail(
            addressStubs.has(sourceId)
              ? "function address binding stub must be environment-free"
              : "imported functions cannot carry an environment or receiver",
          );
        const signature = signatures[functions.length];
        if (signature === undefined) throw "imported signature invariant";
        const binding = checked.bindings.bindings[bindingId(body.node)];
        const name =
          binding?.kind === "function"
            ? binding.name
            : "import_" + String(sourceId);
        const declaration: FunctionIR = {
          id: functions.length,
          name: name + "$" + String(sourceId),
          exported: false,
          parameters: signature.parameters.map((_, index) => index),
          slots: signature.parameters,
          returnType: signature.returnType,
          entry: 0,
          blocks: [],
        };
        functions.push(
          imported.has(sourceId)
            ? { ...declaration, import: true }
            : {
                ...declaration,
                blocks: [
                  {
                    id: 0,
                    instructions: [],
                    terminator: {
                      kind: "trap",
                      start: body.node.start,
                      end: body.node.end,
                    },
                  },
                ],
              },
        );
        continue;
      }
      const sourceBody = body.body;
      const explicitResult =
        body.explicitResult === true ? body.result : undefined;
      const functionSignature = signatures[functions.length];
      if (functionSignature === undefined) throw "function signature invariant";
      const returnType = functionSignature.returnType,
        locals: Local[] = [],
        localByBinding = new Map<number, Local>(),
        localByNode = createKeyIndex<Span, Local>(syntaxHash),
        captureSlots = new Map<number, number>();
      const ownedBindingIds = bindingsByOwner[sourceId] ?? [];
      const selected: BoundBinding[] = [];
      for (const id of ownedBindingIds) {
        if (id === undefined) throw "owned binding invariant";
        const binding = checked.bindings.bindings[id];
        if (binding === undefined) throw "owned binding invariant";
        if (direct[binding.id] === undefined) selected.push(binding);
      }
      for (const capture of fn.captures) {
        if (capture === undefined) fail("capture array invariant");
        if (
          direct[capture.binding] !== undefined ||
          constants.has(capture.binding)
        )
          continue;
        const b = checked.bindings.bindings[capture.binding];
        if (
          b === undefined ||
          (layout === undefined
            ? ownedCells[b.id] === undefined
            : b.scope !== layout.scope)
        )
          fail("entries must capture one supplied lexical environment");
        selected.push(b);
      }
      for (const b of selected) {
        if (b === undefined) fail("b array invariant");
        const local: Local = {
          id: locals.length,
          name: b.name,
          type: bindingScalar(b.id),
          mutable: b.mutable,
          parameter: b.kind === "parameter" || b.owner !== sourceId,
          hoisted: b.kind === "var",
          span: b.node,
        };
        locals.push(local);
        localByBinding.set(b.id, local);
        localByNode.set(b.node, local);
        if (
          layout !== undefined &&
          (b.owner !== sourceId || (initializing && b.captured))
        ) {
          if (layout === undefined)
            fail("module captures require managed module initialization");
          const cell = layout.cells.findIndex(
            (c) => c !== undefined && c.binding === b.id,
          );
          if (cell < 0) fail("missing capture cell");
          captureSlots.set(local.id, cell);
        }
      }
      for (const alias of checked.bindings.aliases ?? []) {
        if (alias === undefined) throw "binding alias invariant";
        const local = localByBinding.get(alias.binding);
        if (local !== undefined) localByNode.set(alias.node, local);
      }
      // Native object keys share one hash; index declaration nodes by syntax
      // hash so long entry bodies do not probe every prior declaration.
      const declarations = createKeyIndex<Binding | Parameter, Local>(
          syntaxHash,
        ),
        parameters: Parameter[] = [];
      for (const p of body.parameters) {
        if (p === undefined) fail("p array invariant");
        parameters.push(p);
        const local = localByNode.get(p);
        if (local === undefined) throw "parameter adapter invariant";
        declarations.set(p, local);
      }
      const bindingIterationLocals = createKeyIndex<Span, Local>(syntaxHash);
      const dynamicAliases = new Map<string, number>();
      const dynamicSignatures: number[] = [];
      for (const binding of selected) {
        if (binding === undefined) fail("entry binding invariant");
        if (!binding.name.startsWith(dynamicRuntimeAliasPrefix)) continue;
        const local = localByBinding.get(binding.id);
        const typeId = checked.bindingTypes[binding.id];
        const signature =
          typeId === undefined ? undefined : checked.types[typeId];
        if (
          local === undefined ||
          local.type !== "reference" ||
          signature?.kind !== "function"
        )
          fail("dynamic-object runtime requires a typed function");
        const result: SourceScalarType | "void" =
          checked.types[signature.result]?.kind === "void"
            ? "void"
            : scalar(signature.result);
        dynamicSignatures[local.id] = callbackSignature(
          signature.parameters.map(scalar),
          result,
          typeId,
        );
        dynamicAliases.set(
          binding.name.slice(dynamicRuntimeAliasPrefix.length),
          local.id,
        );
      }
      const dynamicObjects: DynamicObjectRuntime | undefined =
        !dynamicAliases.has("create")
          ? undefined
          : {
              ...dynamicObjectRuntime((name) => {
                const local = dynamicAliases.get(name);
                if (local === undefined)
                  fail("missing dynamic-object runtime helper: " + name);
                return local;
              }, dynamicAliases.has("bindingObject")),
              update: dynamicAliases.get("update"),
              speculativeBinary: dynamicAliases.get("speculativeBinary"),
              speculativeString: dynamicAliases.get("speculativeString"),
              speculativeUnary: dynamicAliases.get("speculativeUnary"),
            };
      const expressions = createKeyIndex<Expression, ExpressionInfo>(
        syntaxHash,
      );
      const nativeClosures = new Set<number>();
      function knownNativeClosure(input: Expression): boolean {
        let node = input;
        while (node.kind === "group" || node.kind === "satisfies")
          node = node.expression;
        const type = checked.expressions.get(node);
        return (
          checked.types[type ?? -1]?.kind === "function" ||
          (node.kind === "identifier" &&
            nativeClosures.has(referenceBindings.get(node) ?? -1))
        );
      }
      function nativeCallableType(id: number): boolean {
        const type = checked.types[id];
        if (type?.kind === "function") return true;
        if (type?.kind !== "union") return false;
        let callable = false;
        for (const member of type.members) {
          if (member === undefined) throw "callable union member invariant";
          if (checked.types[member]?.kind === "undefined") continue;
          if (!nativeCallableType(member)) return false;
          callable = true;
        }
        return callable;
      }
      function stringExpression(node: Expression): boolean {
        if (node.kind === "group") return stringExpression(node.expression);
        if (node.kind === "string") return true;
        const t = checked.expressions.get(node);
        return t !== undefined && stringType(checked, t);
      }
      function exprArguments(args: readonly Expression[]): void {
        for (const argument of args) {
          if (argument === undefined) fail("argument expression invariant");
          expr(argument.kind === "spread" ? argument.value : argument);
        }
      }
      function finiteAccess(
        node: Expression,
        receiver: Expression,
        type: SourceScalarType | "void",
        write: boolean,
      ): boolean {
        const keys = checked.finitePropertyKeys?.get(node);
        if (keys === undefined) return false;
        const contracts = recordContracts;
        if (contracts === undefined || type === "void")
          fail("finite property access requires native record lowering");
        const cases: FiniteRecordAccess[] = [];
        for (const key of keys) {
          if (key === undefined) fail("finite property key invariant");
          const access: Expression = {
            kind: "member",
            object: receiver,
            property: key,
            start: node.start,
            end: node.end,
          };
          contracts.access(access, receiver, key, type, write);
          const plan = contracts.accesses.get(access);
          if (plan === undefined) fail("finite property access invariant");
          cases.push({ key, access: plan });
        }
        contracts.addFiniteAccess(node, cases);
        return true;
      }
      function expr(input: Expression): void {
        const node = input;
        const chain = checked.chainValues.get(node);
        const receiverContract = checked.chainReceivers.get(node);
        const checkedType = checked.expressions.get(node);
        const dynamicIntrinsic = checked.intrinsics.get(node);
        const speculative = flowStorage?.values.has(node) === true;
        const type: SourceScalarType | "void" =
          speculative || dynamicIntrinsic === "flow-property-read-boxed"
            ? "general"
            : checkedType !== undefined &&
                (checked.types[checkedType]?.kind === "void" ||
                  checked.types[checkedType]?.kind === "never")
              ? "void"
              : layout === undefined && stringExpression(node)
                ? "string"
                : scalar(checkedType);
        let callee: number | undefined;
        let functionTarget: number | undefined;
        let indirect = false;
        const referenceBinding = referenceBindings.get(node);
        let constant = constants.get(referenceBinding ?? -1);
        let local = localByBinding.get(referenceBinding ?? -1)?.id,
          builtin: ExpressionInfo["builtin"];
        let element: ExpressionInfo["setElement"];
        let key: ExpressionInfo["mapKey"], mapValue: ExpressionInfo["mapValue"];
        function selectMap(receiver: Expression): void {
          const type = receiverContract ?? checked.expressions.get(receiver),
            encoding =
              type === undefined ? undefined : mapEncoding(checked, type);
          key = encoding?.key;
          mapValue = encoding?.value;
          if (
            encoding === undefined ||
            !maps.some((m) => m.key === key && m.value === mapValue)
          )
            fail("maps require an explicit compatible runtime");
        }
        function selectSet(receiver: Expression): void {
          const type = receiverContract ?? checked.expressions.get(receiver);
          element = type === undefined ? undefined : setElement(checked, type);
          if (element === undefined || !sets.some((s) => s.element === element))
            fail("sets require an explicit compatible runtime");
        }
        function markSetIterable(input: Expression): void {
          const type = checked.expressions.get(input);
          if (type === undefined || checked.types[type]?.kind !== "set") return;
          const encoding = setElement(checked, type);
          if (
            encoding === undefined ||
            sets.find((s) => s !== undefined && s.element === encoding)?.runtime
              .iterator === undefined
          )
            fail("Set iteration requires a registered iterator runtime");
          const metadata = expressions.get(input);
          if (metadata === undefined) fail("Set iterable expression invariant");
          expressions.set(input, { ...metadata, setElement: encoding });
        }
        // C views (docs/native-ffi.md): the scalar lowering emits each
        // creation, member and element access itself.
        const viewUse = checked.cViewUses.get(node);
        let viewTarget: CViewUse | undefined;
        let dynamicObject: ExpressionInfo["dynamicObject"];
        let dynamicContract: string | undefined;
        let propertyKey: string | undefined;
        function planProperty(
          receiver: Expression,
          key: string | undefined,
        ): void {
          if (
            key === undefined ||
            type === "void" ||
            recordContracts === undefined
          )
            fail("literal property operation requires record lowering");
          propertyKey = key;
          const receiverType =
            receiverContract ?? checked.expressions.get(receiver);
          if (receiverType === undefined)
            fail("literal property receiver invariant");
          recordContracts.planProperty(node, receiverType, key, type);
        }
        let realmGlobal: number | undefined;
        let realmInstaller: string | undefined;
        let realmMember = false;
        let realmInstanceOf: number | undefined;
        let arrayInstance: ExpressionInfo["arrayInstance"];
        let generalCall: ExpressionInfo["generalCall"];
        if (viewUse !== undefined) {
          if (node.kind === "member") expr(node.object);
          else if (node.kind === "index") {
            expr(node.object);
            expr(node.index);
          } else if (node.kind === "call") exprArguments(node.arguments);
          else fail("C view use invariant");
        } else
          switch (node.kind) {
            case "function-expression":
            case "arrow": {
              const fn = checked.bindings.functions.find(
                (f) => f !== undefined && f.node === node,
              );
              functionTarget = fn === undefined ? undefined : targetIds[fn.id];
              if (functionTarget === undefined || layout !== undefined)
                fail("arrow requires an included managed function");
              break;
            }
            case "array": {
              if (dynamicIntrinsic === "dynamic-object-array-literal") {
                if (dynamicObjects === undefined)
                  fail("realm array literal requires the program realm");
                dynamicObject = "array-literal";
                for (const element of node.elements) {
                  if (element === undefined)
                    fail("realm array element invariant");
                  if (element.kind === "spread")
                    fail(
                      "realm array literals with spread require iterable lowering",
                    );
                  if (element.kind !== "elision") expr(element);
                }
                break;
              }
              const literalElement =
                checkedType === undefined
                  ? undefined
                  : representations.arrayElement(chain ?? checkedType);
              const runtime =
                checkedType === undefined
                  ? undefined
                  : lists.find(
                      (l) => l !== undefined && l.element === literalElement,
                    )?.runtime;
              if (runtime === undefined)
                fail("arrays require an explicit compatible list runtime");
              for (const element of node.elements) {
                if (element === undefined) fail("element array invariant");
                if (element.kind === "elision") {
                  if (runtime.resize === undefined)
                    fail("array elisions require a list resizing helper");
                  continue;
                }
                const input =
                  element.kind === "spread" ? element.value : element;
                expr(input);
                if (element.kind === "spread") markSetIterable(input);
              }
              break;
            }
            case "object":
              if (
                dynamicIntrinsic === "dynamic-object-literal" ||
                dynamicIntrinsic === "dynamic-object-open-literal"
              ) {
                if (dynamicObjects === undefined || checkedType === undefined)
                  fail("dynamic-key object literal requires the program realm");
                dynamicObject = "literal";
                if (dynamicIntrinsic === "dynamic-object-literal")
                  dynamicContract = encodeDynamicContract(checked, checkedType);
                for (const property of node.properties) {
                  if (property === undefined)
                    fail("dynamic object property invariant");
                  if (
                    property.kind !== "spread" &&
                    property.keyExpression !== undefined
                  )
                    expr(property.keyExpression);
                  expr(property.value);
                }
                break;
              }
              if (recordContracts === undefined)
                fail("object construction requires record lowering");
              recordContracts.construct(node);
              for (const property of node.properties) {
                if (property === undefined) fail("object property invariant");
                expr(property.value);
              }
              break;
            case "template-expression":
              if (layout !== undefined)
                fail("templates require managed module lowering");
              for (const substitution of node.substitutions) {
                if (substitution === undefined)
                  fail("template substitution invariant");
                expr(substitution);
                if (scalar(checked.expressions.get(substitution)) === "number")
                  callee = numberFormatter();
              }
              break;
            case "string":
              if (layout !== undefined)
                fail("string values require managed module lowering");
              constant = node.value;
              break;
            case "bigint":
              // The literal helper takes the canonical decimal text.
              if (layout !== undefined)
                fail("BigInt literals require managed module lowering");
              if (bigints === undefined)
                fail("BigInt literals require the bigint runtime");
              break;
            case "this": {
              const owner = fn?.receiver;
              const binding =
                owner === undefined
                  ? undefined
                  : checked.bindings.functions[owner]?.receiverBinding;
              local =
                binding === undefined
                  ? undefined
                  : localByBinding.get(binding)?.id;
              if (owner !== sourceId && local === undefined)
                fail("missing lexical receiver storage");
              break;
            }
            case "null":
            case "number":
            case "boolean":
            case "identifier":
              if (
                node.kind === "identifier" &&
                dynamicIntrinsic === "realm-global"
              ) {
                realmGlobal = dynamicAliases.get("realmGlobal");
                realmInstaller = realmLibraryConstructor(node.name)?.installer;
                if (realmInstaller === undefined)
                  fail("missing realm installer");
                if (realmGlobal === undefined)
                  fail("realm global requires the program realm");
                break;
              }
              if (
                node.kind === "identifier" &&
                checked.intrinsics.get(node) === "numeric-constant"
              )
                constant = numericConstant("", node.name);
              if (
                checkedType !== undefined &&
                checked.types[checkedType]?.kind === "function" &&
                local === undefined &&
                checked.bindingValues?.has(node) !== true
              )
                fail(
                  "named function values require managed hoisted initialization: " +
                    (node.kind === "identifier" ? node.name : node.kind) +
                    " (source " +
                    String(node.start) +
                    ":" +
                    String(node.end) +
                    ")",
                );
              break;
            case "index":
              if (flowStorage?.values.has(node.object) === true) {
                builtin = "speculative-property-read";
                expr(node.object);
                expr(node.index);
                break;
              }
              if (
                dynamicIntrinsic === "flow-property-read" ||
                dynamicIntrinsic === "flow-property-read-boxed"
              ) {
                builtin = dynamicIntrinsic;
                planProperty(
                  node.object,
                  checkedPropertyName(
                    node.index,
                    checked.types[checked.expressions.get(node.index) ?? -1],
                  ),
                );
                expr(node.object);
                expr(node.index);
                break;
              }
              if (finiteAccess(node, node.object, type, false)) {
                expr(node.object);
                expr(node.index);
                break;
              }
              if (dynamicIntrinsic === "dynamic-object-read") {
                if (dynamicObjects === undefined || checkedType === undefined)
                  fail("dynamic-key object read requires the program realm");
                dynamicObject = "read";
                dynamicContract = encodeDynamicContract(
                  checked,
                  chain ?? checkedType,
                );
                expr(node.object);
                expr(node.index);
                break;
              }
              if (checked.intrinsics.get(node) === "list-length")
                builtin = "list-length";
              else if (checked.intrinsics.get(node) === "string-length")
                builtin = "string-length";
              else if (checked.intrinsics.get(node) === "array-length")
                builtin = "array-length";
              if (checked.intrinsics.get(node) === "record-read") {
                const property = checkedPropertyName(
                  node.index,
                  checked.types[checked.expressions.get(node.index) ?? -1],
                );
                if (
                  recordContracts === undefined ||
                  property === undefined ||
                  type === "void"
                )
                  fail("unsupported literal property read");
                recordContracts.access(
                  node,
                  node.object,
                  property,
                  type,
                  false,
                );
              }
              if (checked.intrinsics.get(node) === "list-read")
                builtin = "list-read";
              else if (checked.intrinsics.get(node) === "string-read")
                builtin = "string-read";
              expr(node.object);
              expr(node.index);
              break;
            case "member":
              if (flowStorage?.values.has(node.object) === true) {
                builtin = "speculative-property-read";
                expr(node.object);

                break;
              }
              if (
                dynamicIntrinsic === "flow-property-read" ||
                dynamicIntrinsic === "flow-property-read-boxed"
              ) {
                builtin = dynamicIntrinsic;
                planProperty(node.object, node.property);
                expr(node.object);
                break;
              }
              if (dynamicIntrinsic === "realm-library-read") {
                realmMember = true;
                expr(node.object);
                break;
              }
              if (dynamicIntrinsic === "dynamic-object-read") {
                if (dynamicObjects === undefined || checkedType === undefined)
                  fail("dynamic-key object read requires the program realm");
                dynamicObject = "read";
                dynamicContract = encodeDynamicContract(
                  checked,
                  chain ?? checkedType,
                );
                expr(node.object);
                break;
              }
              if (
                checkedType !== undefined &&
                checked.types[checkedType]?.kind === "undefined"
              ) {
                expr(node.object);
                break;
              }
              if (checked.intrinsics.get(node) === "map-size") {
                selectMap(node.object);
                builtin = "map-size";
                expr(node.object);
                break;
              }
              if (checked.intrinsics.get(node) === "set-size") {
                selectSet(node.object);
                builtin = "set-size";
                expr(node.object);
                break;
              }
              if (checked.intrinsics.get(node) === "list-length") {
                builtin = "list-length";
                expr(node.object);
                break;
              }
              if (checked.intrinsics.get(node) === "numeric-constant") {
                let receiver = node.object;
                while (
                  receiver.kind === "group" ||
                  receiver.kind === "satisfies"
                )
                  receiver = receiver.expression;
                if (receiver.kind !== "identifier")
                  fail("numeric global receiver invariant");
                constant = numericConstant(receiver.name, node.property);
                break;
              }
              if (checked.intrinsics.get(node) === "string-length") {
                builtin = "string-length";
                expr(node.object);
                break;
              }
              const metadata = checked.intrinsics.get(node);
              if (metadata === "error-property") {
                builtin = metadata;
                if (recordContracts !== undefined) {
                  const propertyType =
                    node.property === "stack" ? "optional-string" : "string";
                  recordContracts.errorProperty(
                    node,
                    node.property,
                    propertyType,
                  );
                }
                expr(node.object);
                break;
              }
              if (
                metadata === "array-buffer" ||
                metadata === "array-byte-offset" ||
                metadata === "array-byte-length"
              ) {
                builtin = metadata;
                expr(node.object);
                break;
              }
              if (metadata !== "array-length") {
                if (recordContracts === undefined || type === "void")
                  fail("unsupported member access");
                recordContracts.access(
                  node,
                  node.object,
                  node.property,
                  chain === undefined ? type : scalar(chain),
                  false,
                );
              }
              expr(node.object);
              break;
            case "satisfies":
              if (dynamicIntrinsic === "dynamic-object-enroll") {
                if (dynamicObjects === undefined || checkedType === undefined)
                  fail(
                    "dynamic-key object enrollment requires the program realm",
                  );
                dynamicObject = "enroll";
                dynamicContract = encodeDynamicContract(checked, checkedType);
              }
              expr(node.expression);
              break;
            case "group":
              expr(node.expression);
              break;
            case "unary":
              if (dynamicIntrinsic === "dynamic-object-delete") {
                if (dynamicObjects === undefined)
                  fail("dynamic-key object delete requires the program realm");
                let target = node.operand;
                while (target.kind === "group" || target.kind === "satisfies")
                  target = target.expression;
                if (target.kind !== "member" && target.kind !== "index")
                  fail("dynamic delete target invariant");
                dynamicObject = "delete";
                expr(target.object);
                if (target.kind === "index") expr(target.index);
                break;
              }
              expr(node.operand);
              break;
            case "binary": {
              if (dynamicIntrinsic === "list-has") {
                const element = representations.arrayElement(
                  checked.expressions.get(node.right) ?? -1,
                );
                if (
                  lists.find((list) => list?.element === element)?.runtime
                    .has === undefined
                )
                  fail("array membership requires the list presence helper");
                builtin = "list-has";
                expr(node.left);
                expr(node.right);
                break;
              }
              if (dynamicIntrinsic === "literal-property-has") {
                builtin = dynamicIntrinsic;
                planProperty(
                  node.right,
                  checkedPropertyName(
                    node.left,
                    checked.types[checked.expressions.get(node.left) ?? -1],
                  ),
                );
                expr(node.left);
                expr(node.right);
                break;
              }
              if (dynamicIntrinsic === "dynamic-object-has") {
                if (dynamicObjects === undefined)
                  fail(
                    "dynamic-key object membership requires the program realm",
                  );
                dynamicObject = "has";
                expr(node.left);
                expr(node.right);
                break;
              }
              const intrinsic = dynamicIntrinsic;
              if (intrinsic === "realm-instanceof") {
                realmInstanceOf = dynamicAliases.get("realmInstanceOf");
                if (realmInstanceOf === undefined)
                  fail("instanceof requires the program realm");
                expr(node.left);
                expr(node.right);
                break;
              }
              if (intrinsic === "array-instanceof") {
                let target = node.right;
                while (target.kind === "group") target = target.expression;
                if (target.kind !== "identifier")
                  fail("typed-array constructor invariant");
                const name = target.name;
                if (
                  name !== "Uint8Array" &&
                  name !== "Uint16Array" &&
                  name !== "Uint32Array" &&
                  name !== "Float64Array"
                )
                  fail("typed-array kind invariant");
                arrayInstance = name;
                realmGlobal = dynamicAliases.get("realmGlobal");
                realmInstanceOf = dynamicAliases.get("realmInstanceOf");
                expr(node.left);
                break;
              }
              if (
                intrinsic === "type-error-is" ||
                intrinsic === "range-error-is" ||
                intrinsic === "error-is"
              ) {
                builtin = intrinsic;
                realmGlobal = dynamicAliases.get("realmGlobal");
                realmInstanceOf = dynamicAliases.get("realmInstanceOf");
                expr(node.left);
                break;
              }
              if (node.operator === ",") {
                expr(node.left);
                expr(node.right);
                break;
              }
              if (
                [node.left, node.right].some((operand): boolean => {
                  if (operand === undefined) return false;
                  const checkedType = checked.expressions.get(operand);
                  return (
                    checkedType !== undefined &&
                    (representations.entryType(checkedType) === "primitive" ||
                      representations.entryType(checkedType) === "general")
                  );
                })
              ) {
                if (!["===", "!==", "&&", "||", "??"].includes(node.operator))
                  fail(
                    "mixed primitive operation requires payload-aware lowering",
                  );
                expr(node.left);
                expr(node.right);
                break;
              }
              const ls = stringExpression(node.left),
                rs = stringExpression(node.right);
              if (node.operator === "+" && (ls || rs)) {
                const operands = [node.left, node.right].map((n) =>
                  scalar(checked.expressions.get(n)),
                );
                if (
                  !operands.every(
                    (t, i) =>
                      t === "string" ||
                      t === "number" ||
                      t === "boolean" ||
                      (t === "reference" &&
                        bigIntType(
                          checked,
                          checked.expressions.get(
                            i === 0 ? node.left : node.right,
                          ) ?? -1,
                        ) === "reference"),
                  )
                )
                  fail(
                    "string concatenation requires supported primitive operands",
                  );
                if (operands.includes("number")) {
                  callee = numberFormatter();
                }
                expr(node.left);
                expr(node.right);
                break;
              }
              if (
                (ls || rs) &&
                !(
                  ["===", "!==", "==", "!=", "??", "&&", "||"].includes(
                    node.operator,
                  ) &&
                  [node.left, node.right].every((n): boolean => {
                    const t = checked.expressions.get(n);
                    return (
                      t !== undefined &&
                      (checked.types[t]?.kind === "undefined" ||
                        ["string", "optional-string"].includes(
                          representations.entryType(t) ?? "",
                        ))
                    );
                  })
                ) &&
                (!(ls && rs) ||
                  ![
                    "===",
                    "!==",
                    "==",
                    "!=",
                    "&&",
                    "||",
                    "+",
                    "<",
                    ">",
                    "<=",
                    ">=",
                  ].includes(node.operator))
              )
                fail(
                  "string lowering requires string comparison or logical operands",
                );
              expr(node.left);
              expr(node.right);
              break;
            }
            case "conditional":
              expr(node.test);
              expr(node.consequent);
              expr(node.alternate);
              break;
            case "assignment":
            case "compound":
            case "update": {
              if (
                node.kind === "assignment" &&
                checked.bindingInitializations?.has(node)
              ) {
                bindingPlan(node);
                break;
              }
              let target = node.target;
              while (target.kind === "group" || target.kind === "satisfies")
                target = target.expression;
              if (
                target.kind === "index" &&
                node.kind === "assignment" &&
                finiteAccess(node, target.object, type, true)
              ) {
                expr(target.object);
                expr(target.index);
                expr(node.value);
                break;
              }
              if (
                dynamicIntrinsic === "dynamic-object-update" ||
                dynamicIntrinsic === "dynamic-object-compound"
              ) {
                if (
                  dynamicObjects === undefined ||
                  checkedType === undefined ||
                  (target.kind !== "member" && target.kind !== "index")
                )
                  fail("realm property update requires the program realm");
                dynamicObject =
                  dynamicIntrinsic === "dynamic-object-update"
                    ? "update"
                    : "compound";
                dynamicContract = encodeDynamicContract(checked, checkedType);
                expr(target.object);
                if (target.kind === "index") expr(target.index);
                if (node.kind !== "update") expr(node.value);
                break;
              }
              if (
                dynamicIntrinsic === "dynamic-object-write" &&
                node.kind === "assignment"
              ) {
                if (
                  dynamicObjects === undefined ||
                  (target.kind !== "member" && target.kind !== "index")
                )
                  fail("dynamic-key object write requires the program realm");
                dynamicObject = "write";
                expr(target.object);
                if (target.kind === "index") expr(target.index);
                expr(node.value);
                break;
              }
              if (
                (target.kind === "member" || target.kind === "index") &&
                checked.cViewUses.has(target)
              ) {
                viewTarget = checked.cViewUses.get(target);
                expr(target.object);
                if (target.kind === "index") expr(target.index);
                if (node.kind !== "update") expr(node.value);
                break;
              }
              if (
                (target.kind === "member" || target.kind === "index") &&
                checked.intrinsics.get(node) === "list-resize"
              ) {
                const element = representations.arrayElement(
                  checked.expressions.get(target.object) ?? -1,
                );
                if (
                  lists.find((l) => l !== undefined && l.element === element)
                    ?.runtime.resize === undefined
                )
                  fail("array length assignment requires a resizing helper");
                builtin = "list-resize";
                expr(target.object);
                if (target.kind === "index") expr(target.index);
                if (node.kind !== "update") expr(node.value);
                break;
              }
              if (
                target.kind === "member" ||
                (target.kind === "index" &&
                  checked.intrinsics.get(node) === "record-write")
              ) {
                const property =
                  target.kind === "member"
                    ? target.property
                    : checkedPropertyName(
                        target.index,
                        checked.types[
                          checked.expressions.get(target.index) ?? -1
                        ],
                      );
                if (property === undefined)
                  fail("missing literal property name");
                if (recordContracts === undefined || type === "void")
                  fail("unsupported property assignment");
                recordContracts.access(
                  target,
                  target.object,
                  property,
                  type,
                  true,
                );
                expr(target.object);
                if (target.kind === "index") expr(target.index);
                if (node.kind !== "update") expr(node.value);
                break;
              }
              if (node.kind === "assignment" && target.kind === "index") {
                if (checked.intrinsics.get(node) === "list-write")
                  builtin = "list-write";
                expr(target.object);
                expr(target.index);
                expr(node.value);
                break;
              }
              if (target.kind !== "identifier")
                fail(
                  "only local and captured scalar assignments are supported",
                );
              local = localByBinding.get(
                referenceBindings.get(target) ?? -1,
              )?.id;
              if (local === undefined) fail("unknown assignment target");
              if (node.kind !== "update") expr(node.value);
              break;
            }
            case "new": {
              const intrinsic = checked.intrinsics.get(node);
              if (intrinsic === "general-construct") {
                const source = recordTarget?.realmConstruct;
                if (source === undefined)
                  fail("general construction requires the program realm");
                generalCall = {
                  target: generalRuntimeHelper(
                    source,
                    ["general", "reference"],
                    "invalid realm construct helper signature",
                  ),
                };
                expr(node.callee);
                exprArguments(node.arguments);
                break;
              }
              if (
                intrinsic === "type-error-new" ||
                intrinsic === "range-error-new" ||
                intrinsic === "error-new"
              ) {
                builtin = intrinsic;
                exprArguments(node.arguments);
                break;
              }
              if (checked.intrinsics.get(node) === "map-new") {
                selectMap(node);
                builtin = "map-new";
                break;
              }
              if (checked.intrinsics.get(node) === "set-new") {
                selectSet(node);
                builtin = "set-new";
                for (const argument of node.arguments) {
                  if (argument === undefined) fail("Set argument invariant");
                  expr(argument);
                  markSetIterable(argument);
                }
                break;
              }
              if (checked.intrinsics.get(node) !== "array-new")
                fail("unsupported constructor");
              if (layout !== undefined)
                fail("owned arrays cannot enter borrowed closure environments");
              builtin = "array-new";
              exprArguments(node.arguments);
              break;
            }
            case "call": {
              const intrinsic = checked.intrinsics.get(node);
              if (intrinsic === "general-call") {
                if (knownNativeClosure(node.callee)) {
                  fallback = {
                    capability: "native-callable-view",
                    location: { start: node.start, end: node.end },
                    owner: { start: sourceOwner.start, end: sourceOwner.end },
                  };
                  fail(nativeClosureCallMessage);
                }
                generalCall = { target: realmCallTarget() };
                expr(node.callee);
                exprArguments(node.arguments);
                break;
              }
              if (
                intrinsic === "dynamic-object-array-method" ||
                intrinsic === "dynamic-object-static-call"
              ) {
                const target = node.callee;
                if (
                  dynamicObjects === undefined ||
                  checkedType === undefined ||
                  target.kind !== "member"
                )
                  fail("realm method call requires the program realm");
                dynamicObject =
                  intrinsic === "dynamic-object-array-method"
                    ? "array-method"
                    : "static-call";
                dynamicContract = encodeDynamicContract(checked, checkedType);
                if (intrinsic === "dynamic-object-array-method")
                  expr(target.object);
                exprArguments(node.arguments);
                break;
              }
              if (intrinsic === "realm-library-call") {
                let member = node.callee;
                while (member.kind === "group") member = member.expression;
                if (member.kind !== "member")
                  fail("realm library method invariant");
                realmMember = true;
                expr(member.object);
                exprArguments(node.arguments);
                break;
              }
              if (intrinsic === "dynamic-object-own-enumeration") {
                if (dynamicObjects === undefined)
                  fail("Object enumeration requires the program realm");
                dynamicObject = "own-enumeration";
                exprArguments(node.arguments);
                break;
              }
              if (intrinsic === "string-convert") {
                builtin = "string-convert";
                const argument = node.arguments[0];
                if (argument !== undefined) {
                  expr(argument);
                  if (scalar(checked.expressions.get(argument)) === "number")
                    callee = numberFormatter();
                }
                break;
              }
              if (
                intrinsic === "number-from-bigint" ||
                intrinsic === "bigint-identity" ||
                intrinsic === "bigint-from-number" ||
                intrinsic === "bigint-from-boolean"
              ) {
                if (bigints === undefined)
                  fail("BigInt conversion requires the bigint runtime");
                builtin = intrinsic;
                exprArguments(node.arguments);
                break;
              }
              if (intrinsic === "number-from-string") {
                const source = recordTarget?.numberFromString;
                const target =
                  source === undefined ? undefined : targetIds[source];
                const signature =
                  target === undefined ? undefined : signatures[target];
                const parameter =
                  source === undefined ? undefined : parameterType(source, 0);
                const helper =
                  source === undefined
                    ? undefined
                    : checked.bindings.functions[source];
                if (
                  target === undefined ||
                  signature?.returnType !== "number" ||
                  signature.parameters.length !== 1 ||
                  signature.parameters[0] !== "string" ||
                  parameter === undefined ||
                  checked.types[parameter]?.kind !== "string" ||
                  helper === undefined ||
                  helper.parent !== undefined ||
                  helper.captures.length !== 0
                )
                  fail(
                    "Number string conversion requires an included (string) => number runtime helper",
                  );
                callee = target;
                exprArguments(node.arguments);
                break;
              }
              if (
                intrinsic === "map-get" ||
                intrinsic === "map-has" ||
                intrinsic === "map-set" ||
                intrinsic === "map-delete" ||
                intrinsic === "map-clear"
              ) {
                builtin = intrinsic;
                let target = node.callee;
                while (target.kind === "group" || target.kind === "satisfies")
                  target = target.expression;
                if (target.kind !== "member") fail("invalid map receiver");
                selectMap(target.object);
                expr(target.object);
                exprArguments(node.arguments);
                break;
              }

              if (
                intrinsic === "set-has" ||
                intrinsic === "set-add" ||
                intrinsic === "set-delete" ||
                intrinsic === "set-clear"
              ) {
                builtin = intrinsic;
                let target = node.callee;
                while (target.kind === "group" || target.kind === "satisfies")
                  target = target.expression;
                if (target.kind !== "member") fail("invalid set receiver");
                selectSet(target.object);
                expr(target.object);
                exprArguments(node.arguments);
                break;
              }
              if (
                intrinsic === "indexed-for-each" ||
                intrinsic === "list-filter" ||
                intrinsic === "list-map" ||
                intrinsic === "indexed-some" ||
                intrinsic === "indexed-every" ||
                intrinsic === "indexed-find" ||
                intrinsic === "indexed-find-index" ||
                intrinsic === "indexed-find-last" ||
                intrinsic === "indexed-find-last-index"
              ) {
                builtin = intrinsic;
                let target = node.callee;
                while (target.kind === "group" || target.kind === "satisfies")
                  target = target.expression;
                if (target.kind !== "member")
                  fail("invalid map array receiver");
                const receiverType =
                  checked.types[
                    receiverContract ??
                      checked.expressions.get(target.object) ??
                      -1
                  ]?.kind;
                const typed =
                  receiverType === "Uint8Array" ||
                  receiverType === "Uint16Array" ||
                  receiverType === "Uint32Array" ||
                  receiverType === "Float64Array";
                const inputElement = representations.arrayElement(
                  receiverContract ??
                    checked.expressions.get(target.object) ??
                    -1,
                );
                const outputElement = representations.arrayElement(
                  chain ?? checkedType ?? -1,
                );
                const inputRuntime = lists.find(
                  (l) => l !== undefined && l.element === inputElement,
                )?.runtime;
                const outputRuntime = lists.find(
                  (l) => l !== undefined && l.element === outputElement,
                )?.runtime;
                if (
                  (!typed && inputRuntime === undefined) ||
                  (!typed &&
                    intrinsic !== "indexed-find" &&
                    intrinsic !== "indexed-find-index" &&
                    intrinsic !== "indexed-find-last" &&
                    intrinsic !== "indexed-find-last-index" &&
                    inputRuntime?.has === undefined) ||
                  ((intrinsic === "list-map" || intrinsic === "list-filter") &&
                    outputRuntime === undefined) ||
                  (intrinsic === "list-map" &&
                    outputRuntime?.resize === undefined)
                )
                  fail(
                    "array map requires input presence and output resizing helpers",
                  );
                const callback = node.arguments[0];
                if (callback === undefined) fail("map callback invariant");
                const callbackType = checked.expressions.get(callback);
                const signature = checked.types[callbackType ?? -1];
                if (signature?.kind !== "function")
                  fail("map callback signature invariant");
                const parameters = signature.parameters.map(scalar);
                const result: ScalarType | "void" =
                  checked.types[signature.result]?.kind === "never" ||
                  checked.types[signature.result]?.kind === "void"
                    ? "void"
                    : scalar(signature.result);
                callee = callbackSignature(parameters, result, callbackType);
                expr(target.object);
                expr(callback);
                break;
              }
              if (
                intrinsic === "list-shift" ||
                intrinsic === "list-unshift" ||
                intrinsic === "list-fill" ||
                intrinsic === "list-reverse" ||
                intrinsic === "list-at" ||
                intrinsic === "list-sort" ||
                intrinsic === "list-push" ||
                intrinsic === "list-pop" ||
                intrinsic === "list-index-of" ||
                intrinsic === "list-includes" ||
                intrinsic === "list-join" ||
                intrinsic === "list-splice" ||
                intrinsic === "list-slice"
              ) {
                builtin = intrinsic;
                let target = node.callee;
                while (target.kind === "group" || target.kind === "satisfies")
                  target = target.expression;
                if (target.kind !== "member") fail("invalid list receiver");
                if (
                  intrinsic === "list-join" &&
                  representations.arrayElement(
                    receiverContract ??
                      checked.expressions.get(target.object) ??
                      -1,
                  ) === "number"
                )
                  callee = numberFormatter();
                if (intrinsic === "list-sort") {
                  const element = representations.arrayElement(
                    receiverContract ??
                      checked.expressions.get(target.object) ??
                      -1,
                  );
                  if (
                    lists.find((l) => l !== undefined && l.element === element)
                      ?.runtime.sort === undefined
                  )
                    fail(
                      "sort requires a registered comparator-sorting helper",
                    );
                }
                if (intrinsic === "list-index-of") {
                  const element = representations.arrayElement(
                    receiverContract ??
                      checked.expressions.get(target.object) ??
                      -1,
                  );
                  if (
                    lists.find((l) => l !== undefined && l.element === element)
                      ?.runtime.has === undefined
                  )
                    fail("indexOf requires a list presence helper");
                }
                if (intrinsic === "list-slice") {
                  const element = representations.arrayElement(
                    receiverContract ??
                      checked.expressions.get(target.object) ??
                      -1,
                  );
                  const runtime = lists.find(
                    (l) => l !== undefined && l.element === element,
                  )?.runtime;
                  if (
                    runtime === undefined ||
                    runtime.has === undefined ||
                    runtime.resize === undefined
                  )
                    fail("slice requires list presence and resizing helpers");
                }
                if (intrinsic === "list-pop") {
                  const element = representations.arrayElement(
                    receiverContract ??
                      checked.expressions.get(target.object) ??
                      -1,
                  );
                  if (
                    lists.find((l) => l !== undefined && l.element === element)
                      ?.runtime.resize === undefined
                  )
                    fail("pop requires a list resizing helper");
                }
                if (
                  intrinsic === "list-splice" ||
                  intrinsic === "list-reverse" ||
                  intrinsic === "list-shift" ||
                  intrinsic === "list-unshift"
                ) {
                  const element = representations.arrayElement(
                    receiverContract ??
                      checked.expressions.get(target.object) ??
                      -1,
                  );
                  const runtime = lists.find(
                    (l) => l !== undefined && l.element === element,
                  )?.runtime;
                  if (
                    runtime === undefined ||
                    runtime.has === undefined ||
                    runtime.delete === undefined ||
                    (intrinsic !== "list-reverse" &&
                      runtime.resize === undefined)
                  )
                    fail(
                      "array mutation requires list presence, deletion and resizing helpers",
                    );
                }
                expr(target.object);
                exprArguments(node.arguments);
                break;
              }
              if (
                intrinsic === "math-ceil" ||
                intrinsic === "number-is-integer"
              )
                builtin = intrinsic === "math-ceil" ? "ceil" : "is-integer";
              else if (intrinsic === "number-is-safe-integer")
                builtin = "is-safe-integer";
              else if (intrinsic === "number-is-finite") builtin = "is-finite";
              else if (intrinsic === "number-is-nan") builtin = "is-nan";
              else if (intrinsic === "math-floor") builtin = "floor";
              else if (intrinsic === "math-sqrt") builtin = "sqrt";
              else if (intrinsic === "math-round") builtin = "round";
              else if (intrinsic === "math-clz32") builtin = "clz32";
              else if (intrinsic === "math-trunc") builtin = "trunc";
              else if (intrinsic === "math-abs") builtin = "abs";
              else if (intrinsic === "math-sign") builtin = "sign";
              else if (
                intrinsic === "math-min" ||
                intrinsic === "math-max" ||
                intrinsic === "math-imul"
              )
                builtin = intrinsic;
              else if (
                intrinsic === "string-from-code-units" ||
                intrinsic === "string-from-code-points"
              )
                builtin = intrinsic;
              else if (
                intrinsic === "string-code-point" ||
                intrinsic === "string-char-at" ||
                intrinsic === "string-at" ||
                intrinsic === "string-code-unit" ||
                intrinsic === "string-pad-start" ||
                intrinsic === "string-pad-end" ||
                intrinsic === "string-repeat" ||
                intrinsic === "string-concat" ||
                intrinsic === "string-trim" ||
                intrinsic === "string-trim-start" ||
                intrinsic === "string-trim-end" ||
                intrinsic === "string-substring" ||
                intrinsic === "string-slice" ||
                intrinsic === "string-starts-with" ||
                intrinsic === "string-ends-with" ||
                intrinsic === "string-includes" ||
                intrinsic === "string-index-of" ||
                intrinsic === "string-last-index-of" ||
                intrinsic === "string-split"
              ) {
                builtin = intrinsic;
                let target = node.callee;
                while (target.kind === "group" || target.kind === "satisfies")
                  target = target.expression;
                if (target.kind !== "member") fail("invalid string receiver");
                expr(target.object);
              } else if (
                intrinsic === "array-join" ||
                intrinsic === "array-reverse" ||
                intrinsic === "array-at" ||
                intrinsic === "array-fill" ||
                intrinsic === "array-slice" ||
                intrinsic === "array-subarray" ||
                intrinsic === "array-set"
              ) {
                if (
                  (intrinsic === "array-subarray" ||
                    intrinsic === "array-set") &&
                  layout !== undefined
                )
                  fail(
                    "array views and copy snapshots require managed environments",
                  );
                builtin = intrinsic;
                let target = node.callee;
                while (target.kind === "group" || target.kind === "satisfies")
                  target = target.expression;
                if (target.kind !== "member")
                  fail("invalid typed-array receiver");
                if (intrinsic === "array-join") callee = numberFormatter();
                expr(target.object);
              } else if (intrinsic === "function-call") {
                let target = node.callee;
                while (target.kind === "group" || target.kind === "satisfies")
                  target = target.expression;
                if (target.kind !== "member")
                  fail("explicit receiver call invariant");
                const id =
                  checked.chainReceivers.get(node) ??
                  checked.expressions.get(target.object);
                const signature =
                  id === undefined ? undefined : checked.types[id];
                if (layout !== undefined || signature?.kind !== "function")
                  fail("explicit receiver call requires a managed callable");
                builtin = "function-call";
                callee = callbackSignature(
                  signature.parameters.map(scalar),
                  checked.types[signature.result]?.kind === "void" ||
                    checked.types[signature.result]?.kind === "never"
                    ? "void"
                    : scalar(signature.result),
                  id,
                );
                indirect = true;
                expr(target.object);
              } else {
                let target = node.callee;
                while (target.kind === "group" || target.kind === "satisfies")
                  target = target.expression;
                const binding = referenceBindings.get(target);
                const source =
                  binding === undefined ? undefined : direct[binding];
                callee = source === undefined ? undefined : targetIds[source];
                if (callee === undefined) {
                  const id =
                    (chain !== undefined || node.optional
                      ? checked.chainReceivers.get(node)
                      : undefined) ?? checked.expressions.get(target);
                  const signature =
                    id === undefined ? undefined : checked.types[id];
                  if (layout !== undefined || signature?.kind !== "function")
                    fail("call requires a direct function or managed callback");
                  const parameters = signature.parameters.map(scalar);
                  const result: ScalarType | "void" =
                    checked.types[signature.result]?.kind === "void" ||
                    checked.types[signature.result]?.kind === "never"
                      ? "void"
                      : scalar(signature.result);
                  callee = callbackSignature(parameters, result, id);
                  indirect = true;
                  expr(node.callee);
                } else {
                  if (source !== undefined && ownedFunctions.has(source))
                    fail(
                      "direct captured calls require owned environment forwarding",
                    );
                  const targetFn =
                    source === undefined
                      ? undefined
                      : checked.bindings.functions[source];
                  if (
                    targetFn === undefined ||
                    (layout !== undefined &&
                      checked.bindings.functions[targetFn.parent ?? -1]
                        ?.scope !== layout.scope &&
                      !(
                        targetFn.parent === undefined &&
                        targetFn.captures.length === 0
                      ))
                  )
                    fail(
                      "callee must share the supplied activation environment",
                    );
                }
              }
              exprArguments(node.arguments);
              break;
            }
            default:
              fail("expression is outside scalar closure entry lowering");
          }
        const callTarget = node.kind === "call" ? node.callee : undefined;
        const receiverNode =
          node.kind === "member" || node.kind === "index"
            ? node.object
            : builtin !== undefined && callTarget?.kind === "member"
              ? callTarget.object
              : undefined;
        if (
          chain !== undefined &&
          receiverContract !== undefined &&
          receiverNode !== undefined
        ) {
          const receiver = expressions.get(receiverNode);
          if (receiver !== undefined)
            expressions.set(receiverNode, {
              ...receiver,
              listElement:
                representations.arrayElement(receiverContract) ??
                receiver.listElement,
            });
        }
        if (
          realmMember &&
          type !== "void" &&
          type !== "general" &&
          checkedType !== undefined
        )
          dynamicContract = encodeDynamicContract(checked, checkedType);
        const arrayReceiver = arrayFlowReceiver(
          checked,
          node,
          dynamicIntrinsic,
        );
        const source =
          dynamicIntrinsic === "array-set" && node.kind === "call"
            ? node.arguments[0]
            : undefined;
        const sourceType =
          source === undefined ? undefined : checked.expressions.get(source);
        const sourceKind = checked.types[sourceType ?? -1]?.kind;
        const arraySetSource =
          sourceKind === "Uint8Array" ||
          sourceKind === "Uint16Array" ||
          sourceKind === "Uint32Array" ||
          sourceKind === "Float64Array"
            ? sourceKind
            : undefined;
        const generalTypeof =
          node.kind === "unary" &&
          node.operator === "typeof" &&
          (flowStorage?.values.has(node.operand) === true ||
            scalar(checked.expressions.get(node.operand)) === "general");
        const realmTypeof = generalTypeof ? realmTypeofTarget(node) : undefined;
        const restCall = checked.restCalls?.get(node);
        const restElement =
          restCall === undefined
            ? undefined
            : representations.arrayElement(restCall.list);
        if (restCall !== undefined && restElement === undefined)
          fail("rest parameter requires a supported list runtime");
        expressions.set(node, {
          ...(propertyKey === undefined ? {} : { propertyKey }),
          rest:
            restCall === undefined || restElement === undefined
              ? undefined
              : {
                  start: restCall.start,
                  element: restElement,
                  admitsUndefined: restCall.admitsUndefined,
                },
          dynamicObject,
          dynamicContract,
          realmGlobal,
          realmInstaller,
          realmMember: realmMember ? true : undefined,
          realmInstanceOf,
          arrayInstance,
          arrayReceiver,
          arraySetSource,
          arrayMethod: dynamicAliases.get("invokeArrayMethod"),
          dynamicEnrollment: enrollment(checked.dynamicEnrollments?.get(node)),
          chainType:
            chain === undefined
              ? undefined
              : checked.types[chain]?.kind === "void"
                ? "void"
                : scalar(chain),
          chainReceiverType:
            chain === undefined || receiverContract === undefined
              ? undefined
              : scalar(receiverContract),
          never:
            checkedType !== undefined &&
            checked.types[checkedType]?.kind === "never",
          functionTarget,
          indirect,
          voidValueCall: checked.voidValueCalls?.has(node),
          voidCallResults:
            indirect &&
            callee !== undefined &&
            checked.voidValueCalls?.has(node)
              ? voidCallResults(callee)
              : undefined,
          discardCallResult:
            indirect &&
            type === "void" &&
            (checked.voidResultDiscard === true ||
              (checked.voidValueReturns?.size ?? 0) !== 0),
          speculative,
          bigint:
            !speculative &&
            checkedType !== undefined &&
            bigIntType(checked, checkedType) !== undefined,
          realmTypeof,
          generalCall,
          bigIntRecord:
            (generalTypeof && realmTypeof === undefined) ||
            (dynamicIntrinsic === "flow-property-read" &&
              checkedType !== undefined &&
              bigIntType(checked, checkedType) !== undefined)
              ? bigIntRecord()
              : undefined,
          typeofFunction:
            node.kind === "unary" &&
            node.operator === "typeof" &&
            nativeCallableType(checked.expressions.get(node.operand) ?? -1),
          setElement: element,
          listElement:
            checkedType === undefined
              ? undefined
              : representations.arrayElement(chain ?? checkedType),
          mapKey: key,
          mapValue,
          nullValue:
            !speculative &&
            checkedType !== undefined &&
            checked.types[checkedType]?.kind === "null",
          undefinedValue:
            !speculative &&
            checkedType !== undefined &&
            checked.types[checkedType]?.kind === "undefined",
          type,
          local,
          callee,
          builtin,
          constant,
          cView: viewUse ?? viewTarget,
          downcast: downcastOf(node),
        });
      }
      function enrollment(type: number | undefined): string | undefined {
        const id = type;
        if (id === undefined || !hasDynamicObject(checked, id))
          return undefined;
        if (dynamicObjects === undefined)
          fail("dynamic contract requires the program realm");
        return encodeDynamicContract(checked, id);
      }
      function enrollExpression(
        node: Expression,
        type: number | undefined,
      ): void {
        const schema = enrollment(type);
        if (schema === undefined) return;
        const entry = expressions.get(node);
        if (entry === undefined) fail("dynamic contract expression invariant");
        expressions.set(node, { ...entry, dynamicEnrollment: schema });
      }
      /** The run-time tests of a checked downcast: a category per
       * primitive member and a record layout per object member. */
      function downcastOf(node: Expression):
        | {
            readonly tests: readonly DowncastTest[];
            readonly records: readonly number[];
            readonly errors?:
              readonly ("Error" | "TypeError" | "RangeError")[] | undefined;
          }
        | undefined {
        const target = checked.downcasts?.get(node);
        if (target === undefined) return undefined;
        const tests: DowncastTest[] = [],
          records: number[] = [],
          errors: ("Error" | "TypeError" | "RangeError")[] = [];
        function visit(member: number): void {
          const type = checked.types[member];
          if (type === undefined) fail("downcast type invariant");
          switch (type.kind) {
            case "union":
              for (const inner of type.members) {
                if (inner === undefined) fail("downcast union invariant");
                visit(inner);
              }
              return;
            case "Error":
              for (const record of recordContracts?.errorRecords() ?? []) {
                if (record === undefined) throw "Error record invariant";
                if (!records.includes(record)) records.push(record);
              }
              if (!errors.includes("Error")) errors.push("Error");
              return;
            case "RangeError":
            case "TypeError":
              if (!errors.includes(type.kind)) errors.push(type.kind);
              return;
            case "number":
            case "string":
            case "boolean":
            case "undefined":
            case "null":
            case "Uint8Array":
              if (!tests.includes(type.kind)) tests.push(type.kind);
              return;
            case "object": {
              const record = recordContracts?.forType(member);
              if (record === undefined)
                fail(
                  "checked downcasts to object types need one record layout",
                );
              if (!records.includes(record)) records.push(record);
              return;
            }
            case "bigint": {
              const record = bigIntRecord();
              if (record === undefined)
                fail("checked downcasts to bigint need the bigint runtime");
              if (!records.includes(record)) records.push(record);
              return;
            }
            default:
              fail("checked downcast to an untestable type");
          }
        }
        visit(target);
        return { tests, records, errors };
      }
      function bindingPlan(site: Span): void {
        const plan = checked.bindingInitializations?.get(site);
        if (plan === undefined) fail("unchecked binding pattern");
        if (plan.input !== undefined) expr(plan.input);
        expr(plan.root);
        for (const step of plan.steps) {
          if (step === undefined) fail("binding step invariant");
          expr(step.read);
          if (step.array?.realm === true) {
            const type = checked.expressions.get(step.read);
            const metadata = expressions.get(step.read);
            if (type === undefined || metadata === undefined)
              fail("realm iterator projection invariant");
            expressions.set(step.read, {
              ...metadata,
              dynamicContract: encodeDynamicContract(checked, type),
            });
          }
          if (step.initializer !== undefined) expr(step.initializer);
          expr(step.target);
          if (step.assignment !== undefined) expr(step.assignment);
          const binding = step.binding;
          if (binding !== undefined) {
            const local = localByNode.get(binding);
            if (local === undefined) fail("missing binding pattern local");
            declarations.set(binding, local);
          }
        }
      }
      function stmt(input: Statement): void {
        const node = input;
        switch (node.kind) {
          case "block":
            for (const s of node.statements) {
              if (s === undefined) fail("statement array invariant");
              stmt(s);
            }
            break;
          case "variable":
            for (const d of node.declarations) {
              if (d === undefined) fail("declaration array invariant");
              if (d.kind === "object-binding" || d.kind === "array-binding") {
                bindingPlan(d);
                continue;
              }
              const local = localByNode.get(d);
              if (local === undefined) fail("missing entry local");
              declarations.set(d, local);
              const initializer = d.initializer;
              if (initializer !== undefined) {
                expr(initializer);
                if (node.mode === "const" && knownNativeClosure(initializer))
                  nativeClosures.add(bindingId(d));
                if (d.type !== undefined)
                  enrollExpression(
                    initializer,
                    checked.bindingTypes[bindingId(d)],
                  );
              }
            }
            break;
          case "function": {
            const binding = checked.bindings.bindings[bindingId(node)];
            if (binding === undefined)
              fail("missing function declaration binding");
            if (
              layout === undefined &&
              recordTarget !== undefined &&
              direct[binding.id] === undefined
            ) {
              if (!localByBinding.has(binding.id))
                fail("hoisted function requires a local binding");
            } else {
              if (
                sourceBody.kind !== "block" ||
                !sourceBody.statements.includes(node)
              )
                fail("nested declaration placement is not supported");
              if (direct[binding.id] === undefined)
                fail("function declarations require direct-call-only uses");
            }
            break;
          }
          case "throw":
            if (node.expression.kind !== "string") expr(node.expression);
            break;
          case "return": {
            const result = node.expression;
            if (result === undefined) break;
            expr(result);
            enrollExpression(result, explicitResult);
            break;
          }
          case "expression":
            expr(node.expression);
            break;
          case "if":
            expr(node.test);
            stmt(node.consequent);
            if (node.alternate !== undefined) stmt(node.alternate);
            break;
          case "switch":
            expr(node.expression);
            for (const clause of node.clauses) {
              if (clause === undefined) fail("switch clause invariant");
              const test = clause.test;
              if (test !== undefined) {
                if (
                  stringExpression(node.expression) !== stringExpression(test)
                ) {
                  const inputType = checked.expressions.get(node.expression);
                  fail(
                    "switch cannot compare strings with other encodings (source " +
                      String(node.expression.start) +
                      ":" +
                      String(node.expression.end) +
                      ") (type " +
                      (inputType === undefined
                        ? "missing"
                        : String(inputType)) +
                      ")",
                  );
                }
                expr(test);
              }
              for (const child of clause.statements) {
                if (child === undefined) fail("switch statement invariant");
                stmt(child);
              }
            }
            break;
          case "try": {
            stmt(node.body);
            const handler = node.handler;
            if (handler !== undefined) {
              const binding = handler.binding;
              if (binding !== undefined) {
                if (
                  binding.kind === "object-binding" ||
                  binding.kind === "array-binding"
                )
                  bindingPlan(binding);
                else {
                  const local = localByNode.get(binding);
                  if (local === undefined) fail("missing catch local");
                  declarations.set(binding, local);
                }
              }
              stmt(handler.body);
            }
            const finalizer = node.finalizer;
            if (finalizer !== undefined) stmt(finalizer);
            break;
          }
          case "label":
            stmt(node.body);
            break;
          case "do-while":
          case "while":
            expr(node.test);
            stmt(node.body);
            break;
          case "for-in":
          case "for-in-assignment": {
            if (dynamicObjects === undefined)
              fail("for-in requires the program realm");
            expr(node.iterable);
            if (node.kind === "for-in") {
              const binding = node.binding;
              if (
                binding.kind === "array-binding" ||
                binding.kind === "object-binding"
              )
                fail("unchecked for-in binding pattern");
              const local = localByNode.get(binding);
              if (local === undefined) fail("missing for-in binding");
              declarations.set(binding, local);
            } else if (node.kind === "for-in-assignment") {
              let target = node.target;
              while (target.kind === "group" || target.kind === "satisfies")
                target = target.expression;
              if (target.kind === "member" || target.kind === "index") {
                expr(target.object);
                if (target.kind === "index") expr(target.index);
              } else expr(target);
            }
            stmt(node.body);
            break;
          }
          case "for-of": {
            const iterationBinding = node.binding;
            const pattern =
              checked.bindingInitializations?.get(iterationBinding);
            if (
              iterationBinding.kind === "array-binding" &&
              pattern === undefined
            ) {
              expr(node.iterable);
              const iterableType = checked.expressions.get(node.iterable);
              const encoding =
                iterableType === undefined
                  ? undefined
                  : mapEncoding(checked, iterableType);
              if (
                encoding === undefined ||
                maps.find(
                  (m) =>
                    m !== undefined &&
                    m.key === encoding.key &&
                    m.value === encoding.value,
                )?.runtime.iterator === undefined
              )
                fail("map iteration requires a registered iterator runtime");
              const metadata = expressions.get(node.iterable);
              if (metadata === undefined)
                fail("map iterable expression invariant");
              expressions.set(node.iterable, {
                ...metadata,
                mapKey: encoding.key,
                mapValue: encoding.value,
              });
              for (const element of iterationBinding.elements) {
                if (element === undefined) continue;
                if (
                  element.kind === "object-binding" ||
                  element.kind === "array-binding"
                )
                  throw "unchecked nested iteration binding";
                const local = localByNode.get(element);
                if (local === undefined) fail("missing map iteration binding");
                declarations.set(element, local);
              }
              stmt(node.body);
              break;
            }
            const local: Local | undefined =
              pattern === undefined
                ? localByNode.get(iterationBinding)
                : {
                    id: locals.length,
                    name: "",
                    type: scalar(checked.expressions.get(pattern.root)),
                    mutable: false,
                    parameter: false,
                    span: iterationBinding,
                  };
            if (local === undefined) fail("missing iteration binding");
            if (pattern !== undefined) {
              locals.push(local);
              bindingIterationLocals.set(iterationBinding, local);
              bindingPlan(iterationBinding);
            } else {
              if (
                iterationBinding.kind === "object-binding" ||
                iterationBinding.kind === "array-binding"
              )
                fail("unchecked iteration pattern");
              declarations.set(iterationBinding, local);
            }
            const binding =
              checked.bindings.bindings[bindingId(iterationBinding)];
            if (binding?.captured && layout !== undefined)
              fail(
                "captured for-of bindings require per-iteration environments",
              );
            expr(node.iterable);
            const iterableType = checked.expressions.get(node.iterable);
            if (
              iterableType !== undefined &&
              checked.types[iterableType]?.kind === "set"
            ) {
              const element = setElement(checked, iterableType);
              if (
                element === undefined ||
                sets.find((s) => s !== undefined && s.element === element)
                  ?.runtime.iterator === undefined
              )
                fail("set iteration requires a registered iterator runtime");
              const metadata = expressions.get(node.iterable);
              if (metadata === undefined)
                fail("set iterable expression invariant");
              expressions.set(node.iterable, {
                ...metadata,
                setElement: element,
              });
            }
            const iteratedList =
              iterableType === undefined
                ? undefined
                : checked.types[iterableType];
            const elementType =
              pattern === undefined
                ? checked.bindingTypes[bindingId(iterationBinding)]
                : checked.expressions.get(pattern.root);
            if (
              iteratedList?.kind === "array" &&
              elementType !== undefined &&
              !admitsUndefined(checked, elementType)
            ) {
              const metadata = expressions.get(node.iterable);
              if (metadata === undefined)
                fail("list iterable expression invariant");
              expressions.set(node.iterable, { ...metadata, holeCheck: true });
            }
            stmt(node.body);
            break;
          }
          case "for":
            if (node.initializer !== undefined) stmt(node.initializer);
            if (node.test !== undefined) expr(node.test);
            if (node.update !== undefined) expr(node.update);
            stmt(node.body);
            break;
          case "break":
          case "continue":
          case "debugger":
          case "empty":
            break;
          default:
            fail("statement is outside scalar closure entry lowering");
        }
      }
      let block: BlockStatement;
      if (initializing && initializer !== undefined) block = initializer.body;
      else if (sourceBody.kind === "block") block = sourceBody;
      else
        block = {
          kind: "block",
          statements: [
            {
              kind: "return",
              expression: sourceBody,
              start: sourceBody.start,
              end: sourceBody.end,
            },
          ],
          start: body.node.start,
          end: body.node.end,
        };
      for (const p of parameters) {
        if (p === undefined) fail("parameter array invariant");
        if (p.initializer !== undefined) expr(p.initializer);
        if (p.kind === "pattern-parameter") bindingPlan(p);
      }
      stmt(block);
      let bindingPrologue: Statement | undefined;
      if (
        parameters.some(
          (parameter) =>
            parameter !== undefined &&
            checked.bindingRealm?.has(parameter) === true,
        )
      ) {
        const first = block.kind === "block" ? block.statements[0] : undefined;
        if (first?.kind !== "variable" || !dynamicAliases.has("bindingObject"))
          fail("realm binding parameter helper prologue is missing");
        bindingPrologue = first;
      }
      if (block.kind === "block")
        block = {
          ...block,
          statements: block.statements.filter((s) => s.kind !== "function"),
        };
      if (
        (returnType === "optional-number" ||
          returnType === "optional-boolean" ||
          returnType === "optional-string" ||
          returnType === "optional-reference" ||
          returnType === "primitive" ||
          returnType === "general") &&
        block.kind === "block"
      ) {
        const value: Expression = {
          kind: "identifier",
          name: "undefined",
          ...span,
        };
        expressions.set(value, {
          type: "optional-number",
          local: undefined,
          callee: undefined,
        });
        const statements: Statement[] = [];
        for (const statement of block.statements) {
          if (statement === undefined) fail("function statement invariant");
          statements.push(statement);
        }
        statements.push({ kind: "return", expression: value, ...span });
        block = { ...block, statements };
      }
      const sourceBinding = checked.bindings.bindings[bindingId(body.node)];
      const sourceName =
        sourceBinding?.kind === "function" ? sourceBinding.name : undefined;
      const receiverBinding = fn.receiverBinding;
      const receiverLocal =
        receiverBinding === undefined
          ? undefined
          : localByBinding.get(receiverBinding)?.id;
      const adapted: CheckedFunction = {
        ...(receiverLocal === undefined ? {} : { receiverLocal }),
        receiver:
          fn.receiver === sourceId && checked.receiverTypes.has(sourceId),
        exhaustiveSwitches: checked.exhaustiveSwitches,
        id: functions.length,
        node: {
          kind: "function",
          name:
            sourceName === undefined
              ? "closure_" + sourceId
              : sourceName + "$" + sourceId,
          exported: true,
          parameters,
          returnType: undefined,
          body: block,
          start: body.node.start,
          end: body.node.end,
        },
        parameters: parameters.map((p) => {
          const local = declarations.get(p);
          if (local === undefined) throw "parameter invariant";
          return p.initializer === undefined
            ? local.type
            : defaultInput(local.type);
        }),
        returnType,
        locals,
        expressions,
        declarations,
        bindingInitializations: checked.bindingInitializations,
        bindingPrologue,
        bindingIterationLocals,
      };
      const incoming = ownedFunctions.get(sourceId);
      let owned: OwnedEnvironmentPlan | undefined;
      if (recordContracts !== undefined && layout === undefined) {
        const hoisted: OwnedHoistedFunction[] = [];
        const ownedLocalCells: OwnedCell[] = [];
        const constructors = new Map<number, OwnedConstructor>();
        for (const [bindingId, local] of localByBinding) {
          const binding = checked.bindings.bindings[bindingId];
          if (
            binding === undefined ||
            binding.owner !== sourceId ||
            binding.kind !== "function"
          )
            continue;
          const fn = checked.bindings.functions.find(
            (f) => f !== undefined && f.node === binding.node,
          );
          const target = fn === undefined ? undefined : targetIds[fn.id];
          if (target === undefined) fail("hoisted function must be included");
          const scope = checked.bindings.scopes[binding.scope];
          const after = capturePlan.sinks.get(binding.node);
          hoisted.push({
            local: local.id,
            target,
            scope: scope?.kind === "block" ? scope.node : undefined,
            declaration: binding.node,
            ...(after === undefined ? {} : { after }),
          });
        }
        // Declarations created at one point are created in source order:
        // value captures of function declarations rely on it (planning).
        hoisted.sort(
          (left, right) => left.declaration.start - right.declaration.start,
        );
        for (const [bindingId, local] of localByBinding) {
          const record = ownedCells[bindingId];
          if (record === undefined) continue;
          const binding = checked.bindings.bindings[bindingId];
          if (binding === undefined) throw "owned binding invariant";
          const scope = checked.bindings.scopes[binding.scope];
          const field =
            incoming === undefined
              ? undefined
              : incoming.bindings.indexOf(bindingId);
          ownedLocalCells.push({
            local: local.id,
            record,
            byValue: valueCaptures[bindingId] === 1,
            incoming: field === undefined || field < 0 ? undefined : field,
            perIteration: binding.kind === "let" && scope?.kind === "for",
            scope:
              binding.owner === sourceId &&
              (scope?.kind === "block" || scope?.kind === "for")
                ? scope.node
                : undefined,
            declaration: binding.node,
          });
        }
        for (const [source, construction] of ownedFunctions) {
          const target = targetIds[source];
          if (target === undefined) continue;
          const constructorLocals: number[] = [];
          let complete = true;
          for (const binding of construction.bindings) {
            if (binding === undefined) fail("constructor binding invariant");
            const local = localByBinding.get(binding);
            if (local === undefined) {
              complete = false;
              break;
            }
            constructorLocals.push(local.id);
          }
          if (complete)
            constructors.set(target, {
              record: construction.record,
              locals: constructorLocals,
            });
        }
        owned = {
          hoisted,
          record: incoming?.record,
          cells: ownedLocalCells,
          constructors,
        };
      }
      const lowered = lowerFunction(
        adapted,
        signatures,
        recordContracts,
        lists,
        sets,
        maps,
        owned,
        primitives,
        bigints,
        dynamicObjects,
        dynamicSignatures,
        realmErrors,
        nodeErrors,
      );
      recordContracts?.clearFunctionOperations();
      // Debug builds name the slots holding this function's own parameters
      // and locals. Captured and environment-owned bindings live in cells.
      let original = lowered;
      if (recordTarget?.debug === true) {
        const variables: SourceVariable[] = [],
          slots: SlotBinding[] = [];
        for (const [bindingId, local] of localByBinding) {
          const binding = checked.bindings.bindings[bindingId];
          if (binding === undefined) throw "debug binding invariant";
          if (
            binding.owner !== sourceId ||
            captureSlots.has(local.id) ||
            ownedCells[bindingId] !== undefined ||
            local.id >= lowered.slots.length
          )
            continue;
          const type = checked.bindingTypes[bindingId],
            record =
              type === undefined || recordContracts === undefined
                ? undefined
                : recordContracts.plannedRecord(type);
          slots.push({ slot: local.id, variable: variables.length });
          variables.push({
            name: local.name,
            start: local.span.start,
            end: local.span.end,
            parameter: binding.kind === "parameter",
            ...(record === undefined ? {} : { record }),
          });
        }
        original = {
          ...lowered,
          debug: { variables, slots, values: [], inlineSites: [] },
        };
      }
      let initialization: Map<number, Span | undefined> | undefined;
      if (environment !== undefined && initializing) {
        const initialized = new Map<number, Span | undefined>();
        for (const [slot] of captureSlots)
          initialized.set(slot, locals[slot]?.span);
        initialization = initialized;
      }
      functions.push(
        environment === undefined
          ? original
          : cells(
              original,
              captureSlots,
              environment,
              body.parameters.length,
              functions.length,
              signatures,
              initialization,
            ),
      );
    }
    for (let id = entries.length; id < signatures.length; id++) {
      const signature = signatures[id];
      if (signature === undefined) throw "callback signature invariant";
      functions.push({
        id,
        name: "$callback$" + String(id),
        exported: false,
        parameters: signature.parameters.map((_, index) => index),
        slots: signature.parameters,
        returnType: signature.returnType,
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [],
            terminator: { kind: "trap", start: 0, end: 0 },
          },
        ],
      });
    }
    const boundRecordBindings = new Set<number>();
    for (const binding of recordTarget?.recordBindings ?? []) {
      if (binding === undefined) fail("record binding invariant");
      const source = binding.function;
      if (imported.has(source))
        fail("record bindings cannot target imported functions");
      if (boundRecordBindings.has(source))
        fail("invalid or duplicate record binding");
      boundRecordBindings.add(source);
      const target = targetIds[source];
      const body = bodyByFunction[source];
      const bound = checked.bindings.functions[source];
      const fn = target === undefined ? undefined : functions[target];
      if (
        fn === undefined ||
        body === undefined ||
        bound === undefined ||
        bound.parent !== undefined ||
        recordContracts === undefined
      )
        fail("record binding requires a module function");
      const first = fn.parameters[0],
        second = fn.parameters[1];
      if (
        binding.operation === "view-slot" ||
        binding.operation === "set-view-slot"
      ) {
        const read = binding.operation === "view-slot";
        const witnessType = checked.bindingTypes[bindingId(body.parameters[0])];
        const record =
          witnessType === undefined
            ? undefined
            : recordContracts.forType(witnessType);
        const field =
          record === undefined ? undefined : recordContracts.viewSlot(record);
        if (
          first === undefined ||
          fn.slots[first] !== "reference" ||
          (read
            ? fn.parameters.length !== 1 || fn.returnType !== "general"
            : fn.parameters.length !== 2 ||
              second === undefined ||
              fn.slots[second] !== "general" ||
              fn.returnType !== "void") ||
          record === undefined ||
          field === undefined ||
          fn.closureEnvironment !== undefined ||
          fn.environment !== undefined ||
          fn.receiverSlot !== undefined
        )
          fail(
            "view slot bindings take a viewed record (and, to store, an unknown view)",
          );
        functions[fn.id] = bindRecordOperation(
          fn,
          first,
          record,
          binding.operation,
          { start: body.node.start, end: body.node.end },
          field,
        );
        continue;
      }
      const identity = binding.operation === "identity";
      const witness = body.parameters[identity ? 0 : 1];
      const resultView =
        binding.operation === "view" && fn.parameters.length === 1;
      if (
        first === undefined ||
        (identity
          ? fn.parameters.length !== 1 ||
            fn.slots[first] !== "optional-reference"
          : fn.slots[first] !== "general" ||
            (!resultView &&
              (second === undefined ||
                witness === undefined ||
                fn.parameters.length !== 2 ||
                fn.slots[second] !== "reference"))) ||
        (binding.operation === "test"
          ? fn.returnType !== "boolean"
          : binding.operation === "descriptor" || identity
            ? fn.returnType !== "number"
            : binding.operation !== "view" ||
              fn.returnType !== "optional-reference") ||
        fn.closureEnvironment !== undefined ||
        fn.environment !== undefined ||
        fn.receiverSlot !== undefined ||
        body.parameters.some((p) => p.initializer !== undefined)
      )
        fail(
          "record binding requires unknown plus a concrete witness, an optional record identity witness, or a concrete optional view result",
        );
      let selectedType =
        witness === undefined
          ? undefined
          : checked.bindingTypes[bindingId(witness)];
      if (identity) {
        const optional =
          selectedType === undefined ? undefined : checked.types[selectedType];
        if (
          optional === undefined ||
          optional.kind !== "union" ||
          optional.members.length !== 2
        )
          fail(
            "record identity requires a concrete record or undefined witness",
          );
        let absent = false;
        selectedType = undefined;
        for (const member of optional.members) {
          if (member === undefined) throw "record identity type invariant";
          const type = checked.types[member];
          if (type?.kind === "undefined") absent = true;
          else if (type?.kind === "object") selectedType = member;
          else
            fail(
              "record identity requires a concrete record or undefined witness",
            );
        }
        if (!absent || selectedType === undefined)
          fail(
            "record identity requires a concrete record or undefined witness",
          );
      }
      if (resultView) {
        const result = checked.types[body.result];
        if (result?.kind === "union") {
          for (const member of result.members) {
            if (member === undefined) throw "record view type invariant";
            if (checked.types[member]?.kind === "object") {
              selectedType = member;
              break;
            }
          }
        }
      }
      const type = selectedType;
      if (type === undefined || checked.types[type]?.kind !== "object")
        fail("record binding requires a concrete object type");
      const record = recordContracts.forType(type);
      if (record === undefined)
        fail("record witness has no managed record layout");
      if (binding.operation === "view") {
        const result = checked.types[body.result];
        if (result === undefined || result.kind !== "union")
          fail("record view requires the witness type or undefined");
        let absent = false,
          present = false;
        for (const member of result.members) {
          if (member === undefined) throw "record view type invariant";
          const memberType = checked.types[member];
          if (memberType?.kind === "undefined") {
            absent = true;
            continue;
          }
          if (
            memberType?.kind !== "object" ||
            !validatedTypes.value.assignable(type, member) ||
            !validatedTypes.value.assignable(member, type) ||
            recordContracts.forType(member) !== record
          )
            fail("record view result must match the witness type and layout");
          present = true;
        }
        if (!absent || !present)
          fail("record view requires the witness type or undefined");
      }
      functions[fn.id] = bindRecordOperation(
        fn,
        first,
        record,
        binding.operation,
        { start: body.node.start, end: body.node.end },
      );
    }
    for (const binding of recordTarget?.functionAddressBindings ?? []) {
      if (binding === undefined) throw "function address binding invariant";
      const stubId = targetIds[binding.function],
        targetId = targetIds[binding.target];
      const stub = stubId === undefined ? undefined : functions[stubId],
        target = targetId === undefined ? undefined : functions[targetId];
      const body = bodyByFunction[binding.function];
      if (stub === undefined || target === undefined || body === undefined)
        fail("function address binding requires included lowered functions");
      if (
        stub.import === true ||
        stub.environment !== undefined ||
        stub.closureEnvironment !== undefined ||
        stub.receiverSlot !== undefined ||
        stub.parameters.length !== 0 ||
        stub.returnType !== "number"
      )
        fail("function address binding has an invalid lowered stub");
      if (
        target.import === true ||
        target.environment !== undefined ||
        target.closureEnvironment !== undefined ||
        target.receiverSlot !== undefined
      )
        fail("function address binding target must be environment-free");
      functions[stub.id] = bindFunctionAddress(stub, target.id, binding.part, {
        start: body.node.start,
        end: body.node.end,
      });
    }
    const module: ModuleIR =
        recordContracts === undefined
          ? { functions }
          : {
              functions,
              records:
                recordTarget?.debug === true
                  ? recordContracts.records.map((layout, id) => {
                      const names = recordContracts.debugNames(id);
                      return names === undefined
                        ? layout
                        : { ...layout, debug: names };
                    })
                  : recordContracts.records,
            },
      valid = verify(module);
    if (!valid.ok) {
      const block = valid.error.block,
        instruction = valid.error.instruction;
      const original = entries[valid.error.function];
      const source = checked.bindings.functions.find(
        (f) => f !== undefined && f.id === original,
      )?.node;
      const invalidFunction = functions[valid.error.function];
      const invalidBlock =
        invalidFunction === undefined
          ? undefined
          : invalidFunction.blocks.find(
              (b) => b !== undefined && b.id === block,
            );
      const operation =
        invalidBlock === undefined
          ? undefined
          : instruction === undefined
            ? invalidBlock.terminator
            : invalidBlock.instructions[instruction];
      const origin = operation === undefined ? source : operation;
      const location =
        origin === undefined
          ? ""
          : " (source " + String(origin.start) + ":" + String(origin.end) + ")";
      fail(
        valid.error.message +
          " in function " +
          String(valid.error.function) +
          " block " +
          (block === undefined ? "none" : String(block)) +
          " instruction " +
          (instruction === undefined ? "none" : String(instruction)) +
          location,
      );
    }
    const resultEntries: number[] = [];
    for (const entry of entries) {
      if (entry === undefined) fail("entry invariant");
      resultEntries.push(entry);
    }
    return {
      ok: true,
      value: {
        module,
        entries: resultEntries,
        signatureTypes: semanticWitnesses,
        recordTypes:
          recordOptions?.recordTypes === true
            ? recordContracts?.typeRecords.slice()
            : undefined,
      },
    };
  } catch (e) {
    if (e !== abort) throw e;
  }
  return fallback === undefined
    ? { ok: false, error }
    : { ok: false, error, fallback };
}
// Spill original SSA values so guard-induced block splits cannot create cross-block uses.
function cells(
  original: FunctionIR,
  captures: ReadonlyMap<number, number>,
  environment: Environment,
  parameterCount: number,
  id: number,
  signatures: readonly FunctionSignature[],
  initialization: ReadonlyMap<number, Span | undefined> | undefined,
): FunctionIR {
  const slots: ScalarType[] = [];
  for (const slot of original.slots) {
    if (slot === undefined) throw "source slot invariant";
    slots.push(slot);
  }
  const spills = new Map<number, { slot: number; type: ScalarType }>();
  for (const b of original.blocks) {
    if (b === undefined) throw "source block invariant";
    for (const op of b.instructions) {
      if (op === undefined) throw "source instruction invariant";
      const resultId = instructionResult(op);
      if (resultId !== undefined) {
        let type: ScalarType;
        switch (op.kind) {
          case "general-record-is":
          case "general-is":
            type = "boolean";
            break;
          case "error-message":
          case "general-kind":
            type = "string";
            break;
          case "general-null":
          case "general-none":
          case "general-wrap":
            type = "general";
            break;
          case "general-value":
            type = op.type;
            break;
          case "boolean-none":
          case "boolean-wrap":
            type = "optional-boolean";
            break;
          case "error-is":
          case "general-equal":
          case "record-has":
          case "boolean-value":
          case "boolean-present":
            type = "boolean";
            break;
          case "primitive-wrap":
            type = "primitive";
            break;
          case "error-new":
          case "array-buffer":
          case "primitive-reference":
            type = "reference";
            break;
          case "function-new":
            type = "reference";
            break;
          case "function-environment":
            type = "optional-reference";
            break;
          case "constant":
            type = typeof op.value === "number" ? "number" : "boolean";
            break;
          case "load": {
            const t = slots[op.slot];
            if (t === undefined) throw "slot invariant";
            type = t;
            break;
          }
          case "undefined":
          case "optional-wrap":
          case "array-read":
            type = "optional-number";
            break;
          case "optional-present":
          case "array-valid":
            type = "boolean";
            break;
          case "unary":
            type = ["!", "truthy", "is-integer"].includes(op.operator)
              ? "boolean"
              : "number";
            break;
          case "binary":
            type = ["===", "!==", "==", "!=", "<", ">", "<=", ">="].includes(
              op.operator,
            )
              ? "boolean"
              : "number";
            break;
          case "array-new":
            type = op.type;
            break;
          case "call-indirect":
          case "call": {
            const result = signatures[op.target]?.returnType;
            if (result === undefined || result === "void")
              throw "call result invariant";
            type = result;
            break;
          }
          default:
            type = "number";
            break;
        }
        spills.set(resultId, { slot: slots.length, type });
        slots.push(type);
      }
    }
  }
  const blocks: {
      id: number;
      instructions: Instruction[];
      terminator: Terminator | undefined;
    }[] = [],
    starts = new Map<number, number>();
  let next = 0,
    guarded = false;
  function block(): {
    id: number;
    instructions: Instruction[];
    terminator: Terminator | undefined;
  } {
    const typed: {
      id: number;
      instructions: Instruction[];
      terminator: Terminator | undefined;
    } = { id: blocks.length, instructions: [], terminator: undefined };
    blocks.push(typed);
    return typed;
  }
  let current = block();
  function reload(value: number, node: IRSpan): number {
    const saved = spills.get(value);
    if (saved === undefined) throw "spill invariant";
    const id = next++;
    current.instructions.push({
      kind: "load",
      id,
      slot: saved.slot,
      start: node.start,
      end: node.end,
    });
    return id;
  }
  function guard(
    cell: number,
    slot: number,
    operation: "initialize" | "read" | "write",
    node: IRSpan,
  ): void {
    const after = block();
    current.terminator = {
      kind: "cell",
      cell,
      slot,
      operation,
      consequent: after.id,
      alternate: -1,
      start: node.start,
      end: node.end,
    };
    current = after;
    guarded = true;
  }
  for (const old of original.blocks) {
    if (old === undefined) throw "source block invariant";
    if (old.id !== original.entry || starts.size !== 0) current = block();
    starts.set(old.id, current.id);
    if (old.id === original.entry)
      for (const [slot, cell] of captures) {
        if (
          initialization !== undefined &&
          original.parameters.includes(slot)
        ) {
          guard(cell, slot, "initialize", { start: 0, end: 0 });
          continue;
        }
      }
    for (const op of old.instructions) {
      if (op === undefined) throw "source instruction invariant";
      if (op.kind === "load") {
        const cell = captures.get(op.slot);
        if (cell !== undefined) guard(cell, op.slot, "read", op);
      }
      let transformed: Instruction;
      const originalId = instructionResult(op);
      const valueId = originalId === undefined ? undefined : next++;
      switch (op.kind) {
        case "function-environment":
          if (valueId === undefined) throw "definition invariant";
          transformed = { ...op, id: valueId, callee: reload(op.callee, op) };
          break;
        case "error-new":
          if (valueId === undefined) throw "definition invariant";
          transformed = { ...op, id: valueId, message: reload(op.message, op) };
          break;
        case "error-message":
        case "error-is":
          if (valueId === undefined) throw "definition invariant";
          transformed = { ...op, id: valueId, value: reload(op.value, op) };
          break;
        case "record-has":
          if (valueId === undefined) throw "definition invariant";
          transformed = { ...op, id: valueId, object: reload(op.object, op) };
          break;
        case "function-new":
          if (valueId === undefined) throw "definition invariant";
          transformed = {
            ...op,
            id: valueId,
            ...(op.environment === undefined
              ? {}
              : { environment: reload(op.environment, op) }),
          };
          break;
        case "constant":
          if (valueId === undefined) throw "definition invariant";
          transformed = { ...op, id: valueId };
          break;
        case "general-null":
        case "general-none":
        case "boolean-none":
        case "undefined":
          if (valueId === undefined) throw "definition invariant";
          transformed = { ...op, id: valueId };
          break;
        case "load":
          if (valueId === undefined) throw "definition invariant";
          transformed = { ...op, id: valueId };
          break;

        case "array-buffer":
        case "array-byte-offset":
        case "array-byte-length":
        case "array-length":
          if (valueId === undefined) throw "definition invariant";
          transformed = { ...op, id: valueId, array: reload(op.array, op) };
          break;
        case "array-valid":
          if (valueId === undefined) throw "definition invariant";
          transformed = {
            ...op,
            id: valueId,
            array: reload(op.array, op),
            index: reload(op.index, op),
          };
          break;
        case "array-read":
          if (valueId === undefined) throw "definition invariant";
          transformed = {
            ...op,
            id: valueId,
            array: reload(op.array, op),
            index: reload(op.index, op),
          };
          break;

        case "array-write":
          transformed = {
            ...op,
            array: reload(op.array, op),
            index: reload(op.index, op),
            value: reload(op.value, op),
          };
          break;
        case "call-indirect":
          transformed = {
            ...op,
            id: valueId,
            callee: reload(op.callee, op),
            arguments: op.arguments.map((arg): number => {
              if (arg === undefined) throw "argument invariant";
              return reload(arg, op);
            }),
          };
          break;
        case "call":
          transformed = {
            ...op,
            id: valueId,
            arguments: op.arguments.map((arg): number => {
              if (arg === undefined) throw "argument invariant";
              return reload(arg, op);
            }),
            environment: "inherit",
          };
          break;
        case "store":
          transformed = { ...op, value: reload(op.value, op) };
          break;
        case "unary":
          if (valueId === undefined) throw "definition invariant";
          transformed = { ...op, id: valueId, operand: reload(op.operand, op) };
          break;
        case "general-equal":
        case "binary":
          if (valueId === undefined) throw "definition invariant";
          transformed = {
            ...op,
            id: valueId,
            left: reload(op.left, op),
            right: reload(op.right, op),
          };
          break;
        case "general-kind":
        case "general-record-is":
        case "general-is":
        case "general-wrap":
        case "general-value":
        case "primitive-wrap":
        case "primitive-reference":
        case "boolean-wrap":
        case "boolean-value":
        case "boolean-present":
        case "optional-wrap":
          if (valueId === undefined) throw "definition invariant";
          transformed = { ...op, id: valueId, value: reload(op.value, op) };
          break;
        case "optional-present":
          if (valueId === undefined) throw "definition invariant";
          transformed = { ...op, id: valueId, value: reload(op.value, op) };
          break;
        case "optional-value":
          if (valueId === undefined) throw "definition invariant";
          transformed = { ...op, id: valueId, value: reload(op.value, op) };
          break;
        case "optional-value-or":
          if (valueId === undefined) throw "definition invariant";
          transformed = {
            ...op,
            id: valueId,
            value: reload(op.value, op),
            fallback: reload(op.fallback, op),
          };
          break;

        default:
          throw "scalar entry operation invariant";
      }
      current.instructions.push(transformed);
      if (originalId !== undefined && valueId !== undefined) {
        const saved = spills.get(originalId);
        if (saved === undefined) throw "spill invariant";
        current.instructions.push({
          kind: "store",
          slot: saved.slot,
          value: valueId,
          start: op.start,
          end: op.end,
        });
      }
      if (op.kind === "store") {
        const cell = captures.get(op.slot);
        if (cell !== undefined) {
          const declaration =
            initialization === undefined
              ? undefined
              : initialization.get(op.slot);
          const operation: "initialize" | "write" =
            declaration !== undefined &&
            declaration.start === op.start &&
            declaration.end === op.end
              ? "initialize"
              : "write";
          guard(cell, op.slot, operation, op);
        }
      }
    }
    const t = old.terminator;
    if (t.kind === "branch")
      current.terminator = { ...t, condition: reload(t.condition, t) };
    else if (t.kind === "throw")
      current.terminator = { ...t, value: reload(t.value, t) };
    else if (t.kind === "return") {
      const value = t.value;
      current.terminator =
        value === undefined ? t : { ...t, value: reload(value, t) };
    } else current.terminator = t;
  }
  const failure = blocks.length;
  if (guarded) {
    const b = block();
    b.terminator = { kind: "trap", start: 0, end: 0 };
  }
  function target(id: number): number {
    const n = starts.get(id);
    if (n === undefined) throw "block remap invariant";
    return n;
  }
  const completed: Block[] = blocks.map((b): Block => {
    if (b === undefined) throw "cell block invariant";
    const t = b.terminator;
    if (t === undefined) throw "cell block invariant";
    return {
      id: b.id,
      instructions: b.instructions,
      terminator:
        t.kind === "cell"
          ? { ...t, alternate: failure }
          : t.kind === "jump"
            ? { ...t, target: target(t.target) }
            : t.kind === "branch"
              ? {
                  ...t,
                  consequent: target(t.consequent),
                  alternate: target(t.alternate),
                }
              : t,
    };
  });
  return {
    ...original,
    id,
    environment,
    slots,
    parameters: original.parameters.slice(0, parameterCount),
    entry: target(original.entry),
    blocks: completed,
  };
}

export type FactoryResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly module: ModuleIR;
        readonly initializer: number;
        readonly exports: readonly {
          readonly name: string;
          readonly function: number;
        }[];
      };
    }
  | { readonly ok: false; readonly error: string };
export function lowerClosureFactory(
  checked: CheckedClosures,
  factory: number,
  layout: EnvironmentLayout,
): FactoryResult {
  const fn = checked.bindings.functions[factory],
    body = checked.bodies.get(factory);
  const factoryBody = body?.body;
  if (
    fn === undefined ||
    body === undefined ||
    factoryBody === undefined ||
    factoryBody.kind !== "block" ||
    fn.captures.length !== 0 ||
    fn.scope !== layout.scope ||
    layout.cells.length === 0
  )
    return {
      ok: false,
      error: "factory requires one owned activation environment",
    };
  const statements = factoryBody.statements,
    last = statements[statements.length - 1];
  const returned = last?.kind === "return" ? last.expression : undefined;
  if (
    last === undefined ||
    returned === undefined ||
    returned.kind !== "object"
  )
    return {
      ok: false,
      error: "factory must end with a closure object return",
    };
  const exports: { name: string; function: number }[] = [],
    entries = [factory];
  for (const property of returned.properties) {
    if (property === undefined)
      return { ok: false, error: "missing factory property" };
    if (
      property.kind === "spread" ||
      (property.value.kind !== "arrow" &&
        property.value.kind !== "function-expression")
    )
      return {
        ok: false,
        error: "factory result properties must be inline closures",
      };
    const child = checked.bindings.functions.find(
      (f) =>
        f !== undefined && f.node === property.value && f.parent === factory,
    );
    if (child === undefined)
      return { ok: false, error: "missing checked factory member" };
    exports.push({ name: property.name, function: entries.length });
    entries.push(child.id);
  }
  const direct = directFunctions(checked);
  for (const statement of statements)
    if (statement !== undefined && statement.kind === "function") {
      const binding = checked.bindings.bindings.find(
          (b) => b !== undefined && b.node === statement,
        ),
        id = binding === undefined ? undefined : direct[binding.id];
      if (id === undefined)
        return {
          ok: false,
          error: "factory helper must be used only as a direct callee",
        };
      if (!entries.includes(id)) entries.push(id);
    }
  // Factory exports may share uncaptured module helpers with other consumers.
  // Follow direct references transitively without adding unrelated module code.
  for (let index = 0; index < entries.length; index++) {
    const owner = entries[index];
    for (const reference of checked.bindings.references) {
      if (reference === undefined) throw "factory reference invariant";
      const binding = reference.binding;
      if (
        binding === undefined ||
        checked.bindings.scopes[reference.scope]?.owner !== owner
      )
        continue;
      const target = direct[binding];
      if (target === undefined || entries.includes(target)) continue;
      const helper = checked.bindings.functions[target];
      if (
        helper !== undefined &&
        helper.parent === undefined &&
        helper.captures.length === 0
      )
        entries.push(target);
    }
  }
  function earlyReturn(input: Statement | undefined): boolean {
    if (input === undefined) throw "statement invariant";
    const node = input;
    switch (node.kind) {
      case "return": {
        const type =
          node.expression === undefined
            ? undefined
            : checked.expressions.get(node.expression);
        return (
          node.expression !== undefined &&
          (type === undefined || checked.types[type]?.kind !== "undefined")
        );
      }
      case "block":
        return node.statements.some(earlyReturn);
      case "if":
        return (
          earlyReturn(node.consequent) ||
          (node.alternate !== undefined && earlyReturn(node.alternate))
        );
      case "switch":
        return node.clauses.some(
          (c) => c !== undefined && c.statements.some(earlyReturn),
        );
      case "label":
      case "do-while":
      case "while":
      case "for-of":
      case "for-in":
      case "for-in-assignment":
      case "for":
        return earlyReturn(node.body);
      default:
        return false;
    }
  }
  const prefix = statements.slice(0, -1);
  if (prefix.some(earlyReturn))
    return { ok: false, error: "factory initializer cannot return early" };
  for (const cell of layout.cells) {
    if (cell === undefined) return { ok: false, error: "missing factory cell" };
    const binding = checked.bindings.bindings[cell.binding];
    if (
      binding === undefined ||
      binding.owner !== factory ||
      binding.scope !== fn.scope
    )
      return { ok: false, error: "factory layout contains unrelated cells" };
  }
  const exhaustiveSwitches = new Set(checked.exhaustiveSwitches);
  const expressions = createKeyIndex<Expression, number>(syntaxHash);
  checked.expressions.forEach((type, expression) =>
    expressions.set(expression, type),
  );
  const booleanType = checked.types.findIndex(
    (t) => t !== undefined && t.kind === "boolean",
  );
  function status(value: boolean, node: Span): Expression {
    const expression: Expression = {
      kind: "boolean",
      value,
      start: node.start,
      end: node.end,
    };
    expressions.set(expression, booleanType);
    return expression;
  }
  function project(input: Statement | undefined): Statement {
    if (input === undefined) throw "statement invariant";
    const node = input;
    switch (node.kind) {
      case "return": {
        const projected: Statement[] = [];
        if (node.expression !== undefined)
          projected.push({
            kind: "expression",
            expression: node.expression,
            start: node.start,
            end: node.end,
          });
        projected.push({
          kind: "return",
          expression: status(false, node),
          start: node.start,
          end: node.end,
        });
        return {
          kind: "block",
          statements: projected,
          start: node.start,
          end: node.end,
        };
      }
      case "block":
        return { ...node, statements: node.statements.map(project) };
      case "if":
        return {
          ...node,
          consequent: project(node.consequent),
          alternate:
            node.alternate === undefined ? undefined : project(node.alternate),
        };
      case "switch": {
        const mapped: Statement = {
          ...node,
          clauses: node.clauses.map((c) => {
            if (c === undefined) throw "switch clause invariant";
            return { ...c, statements: c.statements.map(project) };
          }),
        };
        if (exhaustiveSwitches.has(node)) exhaustiveSwitches.add(mapped);
        return mapped;
      }
      case "label":
      case "do-while":
        return { ...node, body: project(node.body) };
      case "while":
        return { ...node, body: project(node.body) };
      case "for-of":
      case "for-in":
      case "for-in-assignment":
        return { ...node, body: project(node.body) };
      case "for":
        return { ...node, body: project(node.body) };

      default:
        return node;
    }
  }
  const projectedStatements: Statement[] = [];
  for (const statement of prefix) projectedStatements.push(project(statement));
  projectedStatements.push({
    kind: "return",
    expression: status(true, last),
    start: last.start,
    end: last.end,
  });
  const result = lowerEntries(
    { ...checked, expressions, exhaustiveSwitches },
    entries,
    layout,
    {
      function: factory,
      body: {
        kind: "block",
        statements: projectedStatements,
        start: factoryBody.start,
        end: factoryBody.end,
      },
    },
  );
  return result.ok
    ? {
        ok: true,
        value: { module: result.value.module, initializer: 0, exports },
      }
    : result;
}
export { planScalarClosures } from "./planning.ts";
export {
  collectRuntimeRequirements,
  type RuntimeRequirements,
} from "./runtime-requirements.ts";
