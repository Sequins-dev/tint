/** Pure module linkage metadata shared by analysis and execution. No host or heap state. */
export interface ModuleRequest {
  readonly specifier: string;
  /** Omitted is the ordinary evaluation phase. */
  readonly phase?: "source" | "defer";
  readonly attributes: readonly {
    readonly key: string;
    readonly value: string;
  }[];
}
export interface ImportEntry {
  readonly request: number;
  /** undefined imports the namespace object. */
  readonly importName: string | undefined;
  readonly localName: string;
}
export interface LocalExportEntry {
  readonly exportName: string;
  readonly localName: string;
}
export interface IndirectExportEntry {
  readonly exportName: string;
  readonly request: number;
  readonly importName: string | undefined;
}
export interface SourceModuleShape {
  readonly requests: readonly ModuleRequest[];
  readonly imports: readonly ImportEntry[];
  readonly localExports: readonly LocalExportEntry[];
  readonly indirectExports: readonly IndirectExportEntry[];
  readonly starExports: readonly number[];
  readonly hasTopLevelAwait: boolean;
}
/** ECMAScript module names and attribute keys use UTF-16 code-unit order. */
export function compareModuleNames(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const order = left.charCodeAt(index) - right.charCodeAt(index);
    if (order !== 0) return order;
  }
  return left.length - right.length;
}
export function canonicalModuleRequest(request: ModuleRequest): ModuleRequest {
  const attributes: { readonly key: string; readonly value: string }[] = [];
  for (const attribute of request.attributes) {
    if (attribute === undefined) throw "MODULE_REQUEST_INVARIANT";
    let index = attributes.length;
    attributes.push(attribute);
    while (index > 0) {
      const previous = attributes[index - 1];
      if (previous === undefined) throw "MODULE_REQUEST_INVARIANT";
      if (compareModuleNames(previous.key, attribute.key) <= 0) break;
      attributes[index] = previous;
      index--;
    }
    attributes[index] = attribute;
  }
  return {
    specifier: request.specifier,
    attributes,
    ...(request.phase === undefined ? {} : { phase: request.phase }),
  };
}
export function moduleRequestsEqual(
  left: ModuleRequest,
  right: ModuleRequest,
): boolean {
  return left.phase === right.phase && moduleRequestKeysEqual(left, right);
}
/** A loaded resource keeps one identity across source, defer and evaluation requests. */
export function moduleRequestKeysEqual(
  left: ModuleRequest,
  right: ModuleRequest,
): boolean {
  if (
    left.specifier !== right.specifier ||
    left.attributes.length !== right.attributes.length
  )
    return false;
  for (const attribute of left.attributes) {
    if (attribute === undefined) throw "MODULE_REQUEST_INVARIANT";
    let found = false;
    for (const other of right.attributes) {
      if (other === undefined) throw "MODULE_REQUEST_INVARIANT";
      if (attribute.key === other.key && attribute.value === other.value)
        found = true;
    }
    if (!found) return false;
  }
  return true;
}
