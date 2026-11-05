import { stringPropertyKeyOrder } from "./enumeration.ts";

/** Identity is the allocation, never the description or an encoded string key. */
export interface SymbolValue {
  readonly symbolBrand: "symbol";
  readonly description: string | undefined;
}
export type ScriptPropertyKey = string | SymbolValue;

/** Native-only checked view, explicitly authorized by the embedding build.
 * The concrete optional result supplies the record layout without a witness. */
export function viewSymbolValue(value: unknown): SymbolValue | undefined {
  throw "UNBOUND_SYMBOL_VIEW";
}

/** Explicit host-owned registry, shared by all realms belonging to that host.
 * Fresh symbols are not retained here. Registered symbols have registry lifetime. */
export interface SymbolRegistry {
  readonly registered: Map<string, SymbolValue>;
  readonly registeredKeys: Map<SymbolValue, string>;
  readonly wellKnown: Map<string, SymbolValue>;
}

export function createSymbolValue(
  description: string | undefined,
): SymbolValue {
  return { symbolBrand: "symbol", description };
}

export function createSymbolRegistry(): SymbolRegistry {
  return {
    registered: new Map<string, SymbolValue>(),
    registeredKeys: new Map<SymbolValue, string>(),
    wellKnown: new Map<string, SymbolValue>(),
  };
}

export function registeredSymbol(
  registry: SymbolRegistry,
  key: string,
): SymbolValue {
  const existing = registry.registered.get(key);
  if (existing !== undefined) return existing;
  const symbol = createSymbolValue(key);
  registry.registered.set(key, symbol);
  registry.registeredKeys.set(symbol, key);
  return symbol;
}

export function registeredSymbolKey(
  registry: SymbolRegistry,
  symbol: SymbolValue,
): string | undefined {
  return registry.registeredKeys.get(symbol);
}

/** Intrinsic installers request their specified well-known names through this
 * internal operation. This does not expose arbitrary names on the JS Symbol API. */
export function wellKnownSymbol(
  registry: SymbolRegistry,
  name: string,
): SymbolValue {
  const existing = registry.wellKnown.get(name);
  if (existing !== undefined) return existing;
  const symbol = createSymbolValue("Symbol." + name);
  registry.wellKnown.set(name, symbol);
  return symbol;
}

export function symbolDescriptiveString(symbol: SymbolValue): string {
  return "Symbol(" + (symbol.description ?? "") + ")";
}

export function scriptPropertyKeyOrder(key: ScriptPropertyKey): number {
  return typeof key === "string" ? stringPropertyKeyOrder(key) : -2;
}

/** SetFunctionName's key spelling; symbols without a description use an empty name. */
export function propertyFunctionName(key: ScriptPropertyKey): string {
  if (typeof key === "string") return key;
  return key.description === undefined ? "" : "[" + key.description + "]";
}
