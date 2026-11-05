export {
  createThisBinding,
  bindThisValue,
  getThisBinding,
  type ThisBinding,
} from "./this-binding.ts";
/** Mutable internal binding state; use the operations below to enforce its lifecycle. */
export interface Binding<Value> {
  value: Value;
  initialized: boolean;
  readonly mutable: boolean;
  readonly strict: boolean;
  readonly deletable: boolean;
}
/** Declarative storage only. Outer-environment resolution and global object
 * bindings belong to the embedding runtime, not to this record. */
export interface DeclarativeEnvironment<Value> {
  readonly bindings: Map<string, Binding<Value>>;
  readonly undefinedValue: Value;
  /** Importers share target cells, but writes are immutable in this environment. */
  importNames: Set<string> | undefined;
}
/** Convert reference/type errors to the corresponding realm's exceptions. */
export type BindingError = "none" | "reference" | "type";
export interface BindingResult<Value> {
  readonly error: BindingError;
  readonly value: Value;
}
export function createDeclarativeEnvironment<Value>(
  undefinedValue: Value,
): DeclarativeEnvironment<Value> {
  return {
    bindings: new Map<string, Binding<Value>>(),
    undefinedValue,
    importNames: undefined,
  };
}
export function hasBinding<Value>(
  record: DeclarativeEnvironment<Value>,
  name: string,
): boolean {
  return record.bindings.has(name);
}
function createBinding<Value>(
  record: DeclarativeEnvironment<Value>,
  name: string,
  mutable: boolean,
  strict: boolean,
  deletable: boolean,
): void {
  if (record.bindings.has(name)) throw "DUPLICATE_BINDING_INVARIANT";
  record.bindings.set(name, {
    value: record.undefinedValue,
    initialized: false,
    mutable,
    strict,
    deletable,
  });
}
export function createMutableBinding<Value>(
  record: DeclarativeEnvironment<Value>,
  name: string,
  deletable: boolean,
): void {
  createBinding<Value>(record, name, true, false, deletable);
}
export function createImmutableBinding<Value>(
  record: DeclarativeEnvironment<Value>,
  name: string,
  strict: boolean,
): void {
  createBinding<Value>(record, name, false, strict, false);
}
/** The module linker declares local target cells before connecting cyclic imports. */
export function createImportBinding<Value>(
  record: DeclarativeEnvironment<Value>,
  name: string,
  target: DeclarativeEnvironment<Value>,
  targetName: string,
): void {
  if (record.bindings.has(name)) throw "DUPLICATE_BINDING_INVARIANT";
  const binding = target.bindings.get(targetName);
  if (binding === undefined) throw "IMPORT_BINDING_INVARIANT";
  let names = record.importNames;
  if (names === undefined) {
    names = new Set<string>();
    record.importNames = names;
  }
  names.add(name);
  record.bindings.set(name, binding);
}

export function initializeBinding<Value>(
  record: DeclarativeEnvironment<Value>,
  name: string,
  value: Value,
): void {
  const binding = record.bindings.get(name);
  if (
    binding === undefined ||
    binding.initialized ||
    record.importNames?.has(name)
  )
    throw "INITIALIZE_BINDING_INVARIANT";
  binding.value = value;
  binding.initialized = true;
}
export function setMutableBinding<Value>(
  record: DeclarativeEnvironment<Value>,
  name: string,
  value: Value,
  strict: boolean,
): BindingError {
  if (record.importNames?.has(name)) return "type";
  const binding = record.bindings.get(name);
  if (binding === undefined) {
    if (strict) return "reference";
    createMutableBinding<Value>(record, name, true);
    initializeBinding<Value>(record, name, value);
    return "none";
  }
  if (!binding.initialized) return "reference";
  if (binding.mutable) binding.value = value;
  else if (strict || binding.strict) return "type";
  return "none";
}
/** Missing names are reported as reference errors; resolution normally checks HasBinding first. */
export function getBindingValue<Value>(
  record: DeclarativeEnvironment<Value>,
  name: string,
): BindingResult<Value> {
  const binding = record.bindings.get(name);
  if (binding === undefined || !binding.initialized)
    return { error: "reference", value: record.undefinedValue };
  return { error: "none", value: binding.value };
}
export function deleteBinding<Value>(
  record: DeclarativeEnvironment<Value>,
  name: string,
): boolean {
  if (record.importNames?.has(name)) return false;
  const binding = record.bindings.get(name);
  if (binding === undefined) return true;
  if (!binding.deletable) return false;
  return record.bindings.delete(name);
}
