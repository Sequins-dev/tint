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
  /** The first four bindings live inline, so most function and block
   * environments allocate no map; further names spill into `overflow`.
   * Deleting an inline binding leaves a hole that the next binding reuses.
   * Use the operations below (or findBinding) rather than these fields. */
  name0: string | undefined;
  binding0: Binding<Value> | undefined;
  name1: string | undefined;
  binding1: Binding<Value> | undefined;
  name2: string | undefined;
  binding2: Binding<Value> | undefined;
  name3: string | undefined;
  binding3: Binding<Value> | undefined;
  overflow: Map<string, Binding<Value>> | undefined;
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
    name0: undefined,
    binding0: undefined,
    name1: undefined,
    binding1: undefined,
    name2: undefined,
    binding2: undefined,
    name3: undefined,
    binding3: undefined,
    overflow: undefined,
    undefinedValue,
    importNames: undefined,
  };
}
/** The binding cell for `name`, or undefined when this record has none. */
export function findBinding<Value>(
  record: DeclarativeEnvironment<Value>,
  name: string,
): Binding<Value> | undefined {
  if (record.name0 === name) return record.binding0;
  if (record.name1 === name) return record.binding1;
  if (record.name2 === name) return record.binding2;
  if (record.name3 === name) return record.binding3;
  const overflow = record.overflow;
  return overflow === undefined ? undefined : overflow.get(name);
}
/** Number of bindings in this record. */
export function bindingCount<Value>(
  record: DeclarativeEnvironment<Value>,
): number {
  const overflow = record.overflow;
  let count = overflow === undefined ? 0 : overflow.size;
  if (record.name0 !== undefined) count++;
  if (record.name1 !== undefined) count++;
  if (record.name2 !== undefined) count++;
  if (record.name3 !== undefined) count++;
  return count;
}
/** Callers have checked that `name` is absent. */
function storeBinding<Value>(
  record: DeclarativeEnvironment<Value>,
  name: string,
  binding: Binding<Value>,
): void {
  if (record.name0 === undefined) {
    record.name0 = name;
    record.binding0 = binding;
  } else if (record.name1 === undefined) {
    record.name1 = name;
    record.binding1 = binding;
  } else if (record.name2 === undefined) {
    record.name2 = name;
    record.binding2 = binding;
  } else if (record.name3 === undefined) {
    record.name3 = name;
    record.binding3 = binding;
  } else {
    const overflow = record.overflow;
    if (overflow === undefined) {
      const created = new Map<string, Binding<Value>>();
      created.set(name, binding);
      record.overflow = created;
    } else overflow.set(name, binding);
  }
}
function removeBinding<Value>(
  record: DeclarativeEnvironment<Value>,
  name: string,
): boolean {
  if (record.name0 === name) {
    record.name0 = undefined;
    record.binding0 = undefined;
    return true;
  }
  if (record.name1 === name) {
    record.name1 = undefined;
    record.binding1 = undefined;
    return true;
  }
  if (record.name2 === name) {
    record.name2 = undefined;
    record.binding2 = undefined;
    return true;
  }
  if (record.name3 === name) {
    record.name3 = undefined;
    record.binding3 = undefined;
    return true;
  }
  const overflow = record.overflow;
  return overflow === undefined ? false : overflow.delete(name);
}
export function hasBinding<Value>(
  record: DeclarativeEnvironment<Value>,
  name: string,
): boolean {
  return findBinding<Value>(record, name) !== undefined;
}
function createBinding<Value>(
  record: DeclarativeEnvironment<Value>,
  name: string,
  mutable: boolean,
  strict: boolean,
  deletable: boolean,
): void {
  if (findBinding<Value>(record, name) !== undefined)
    throw "DUPLICATE_BINDING_INVARIANT";
  storeBinding<Value>(record, name, {
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
  if (findBinding<Value>(record, name) !== undefined)
    throw "DUPLICATE_BINDING_INVARIANT";
  const binding = findBinding<Value>(target, targetName);
  if (binding === undefined) throw "IMPORT_BINDING_INVARIANT";
  let names = record.importNames;
  if (names === undefined) {
    names = new Set<string>();
    record.importNames = names;
  }
  names.add(name);
  storeBinding<Value>(record, name, binding);
}

export function initializeBinding<Value>(
  record: DeclarativeEnvironment<Value>,
  name: string,
  value: Value,
): void {
  const binding = findBinding<Value>(record, name);
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
  const binding = findBinding<Value>(record, name);
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
  const binding = findBinding<Value>(record, name);
  if (binding === undefined || !binding.initialized)
    return { error: "reference", value: record.undefinedValue };
  return { error: "none", value: binding.value };
}
export function deleteBinding<Value>(
  record: DeclarativeEnvironment<Value>,
  name: string,
): boolean {
  if (record.importNames?.has(name)) return false;
  const binding = findBinding<Value>(record, name);
  if (binding === undefined) return true;
  if (!binding.deletable) return false;
  return removeBinding<Value>(record, name);
}
