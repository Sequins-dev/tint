import { compareModuleNames } from "@tint/foundation/modules";
import {
  createExoticObject,
  ordinaryGetOwnProperty,
  ordinaryDefineOwnProperty,
  ordinaryDeleteProperty,
  ordinaryGetProperty,
  ordinaryOwnKeys,
  type ObjectInternalMethods,
  type PropertyDefinitionResult,
  type OrdinaryObject,
} from "../objects/operations.ts";
import { createRuntimeError } from "../objects/errors.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "../objects/symbols.ts";
import {
  valueField,
  writableField,
  getField,
  setField,
  enumerableField,
  configurableField,
  type Descriptor,
} from "../descriptors/index.ts";
import type { Binding } from "../environments/records/index.ts";
import type { ModuleRecord } from "./records.ts";
import { getExportedNames, resolveExport } from "./resolve.ts";
interface NamespaceExport {
  readonly binding: Binding<unknown> | undefined;
  readonly namespaceModule: ModuleRecord | undefined;
}
function symbolOrder(key: ScriptPropertyKey): number {
  return typeof key === "string" ? -1 : -2;
}

/** One exotic namespace per module; reads observe its defining binding cells. */
export function getModuleNamespace(
  module: ModuleRecord,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const cached = module.namespace;
  if (cached !== undefined) return cached;
  const exports_ = new Map<string, NamespaceExport>(),
    names: string[] = [];
  for (const name of getExportedNames(module)) {
    if (name === undefined) throw "MODULE_SHAPE_INVARIANT";
    const resolution = resolveExport(module, name);
    if (resolution === undefined || typeof resolution === "string") continue;
    let entry: NamespaceExport;
    if (resolution.bindingName === undefined)
      entry = { binding: undefined, namespaceModule: resolution.module };
    else {
      const binding = resolution.module.environment.bindings.get(
        resolution.bindingName,
      );
      if (binding === undefined) throw "MODULE_BINDING_INVARIANT";
      entry = { binding, namespaceModule: undefined };
    }
    exports_.set(name, entry);
    names.push(name);
  }
  names.sort((left, right): number => {
    if (left === undefined || right === undefined)
      throw "MODULE_SHAPE_INVARIANT";
    return compareModuleNames(left, right);
  });
  function read(name: string): unknown {
    const entry = exports_.get(name);
    if (entry === undefined) return undefined;
    const target = entry.namespaceModule;
    if (target !== undefined) return getModuleNamespace(target);
    const binding = entry.binding;
    if (binding === undefined) throw "MODULE_BINDING_INVARIANT";
    if (!binding.initialized) {
      const active = module.realm.agent.activeContext;
      throw createRuntimeError(
        active === undefined ? module.realm : active.realm,
        "reference",
      );
    }
    return binding.value;
  }
  function descriptor(name: string): Descriptor<unknown> | undefined {
    if (!exports_.has(name)) return undefined;
    return {
      accessor: false,
      value: read(name),
      writable: true,
      get: undefined,
      set: undefined,
      enumerable: true,
      configurable: false,
    };
  }
  const methods: ObjectInternalMethods<ScriptPropertyKey, unknown> = {
    getPrototype: (
      _object,
    ): OrdinaryObject<ScriptPropertyKey, unknown> | undefined => undefined,
    setPrototype: (_object, prototype): boolean => prototype === undefined,
    isExtensible: (_object): boolean => false,
    preventExtensions: (_object): boolean => true,
    hasProperty: (object, key): boolean =>
      typeof key === "string"
        ? exports_.has(key)
        : ordinaryGetOwnProperty<ScriptPropertyKey, unknown>(object, key) !==
          undefined,
    getOwnProperty: (object, key): Descriptor<unknown> | undefined =>
      typeof key === "string"
        ? descriptor(key)
        : ordinaryGetOwnProperty<ScriptPropertyKey, unknown>(object, key),
    get: (object, key, receiver, hooks): unknown =>
      typeof key === "string"
        ? read(key)
        : ordinaryGetProperty<ScriptPropertyKey, unknown>(
            object,
            key,
            receiver,
            hooks,
          ),
    set: (_object, _key, _value, _receiver, _hooks): boolean => false,
    deleteProperty: (object, key): boolean =>
      typeof key === "string"
        ? !exports_.has(key)
        : ordinaryDeleteProperty<ScriptPropertyKey, unknown>(object, key),
    defineOwnProperty: (
      object,
      key,
      update,
      hooks,
    ): PropertyDefinitionResult => {
      if (typeof key !== "string")
        return ordinaryDefineOwnProperty<ScriptPropertyKey, unknown>(
          object,
          key,
          update,
          hooks,
        );
      const current = descriptor(key);
      if (current === undefined) return "rejected";
      const fields = update.fields;
      if (
        ((fields & configurableField) !== 0 && update.configurable) ||
        ((fields & enumerableField) !== 0 && !update.enumerable) ||
        (fields & (getField | setField)) !== 0 ||
        ((fields & writableField) !== 0 && !update.writable)
      )
        return "rejected";
      if (
        (fields & valueField) !== 0 &&
        !hooks.sameValue(update.value, current.value)
      )
        return "rejected";
      return "accepted";
    },
    ownKeys: (object): ScriptPropertyKey[] => {
      const keys: ScriptPropertyKey[] = [];
      for (const name of names) {
        if (name === undefined) throw "MODULE_SHAPE_INVARIANT";
        keys.push(name);
      }
      for (const key of ordinaryOwnKeys<ScriptPropertyKey, unknown>(
        object,
        symbolOrder,
      ))
        if (typeof key !== "string") {
          if (key === undefined) throw "MODULE_SHAPE_INVARIANT";
          keys.push(key);
        }
      return keys;
    },
  };
  const namespace = createExoticObject<ScriptPropertyKey, unknown>(
    undefined,
    methods,
  );
  const tag = wellKnownSymbol(module.realm.symbolRegistry, "toStringTag");
  const tagDescriptor: Descriptor<unknown> = {
    accessor: false,
    value: "Module",
    writable: false,
    get: undefined,
    set: undefined,
    enumerable: false,
    configurable: false,
  };
  // Construction initializes the ordinary symbol backing store before sealing.
  namespace.properties.set(tag, tagDescriptor);
  namespace.extensible = false;
  module.namespace = namespace;
  return namespace;
}
