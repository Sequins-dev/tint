export interface RuntimeSource {
  readonly module: string;
  /** Stable helper contract identity, independent of source package ownership. */
  readonly namespace: string;
  /** When supplied, retain only these concrete exports outside the application
   * instance. Other declarations and dependency state initialize normally.
   * Omitted retains the runtime and its transitive implementation dependencies. */
  readonly retainedExports?: readonly string[];
}

/** Contract IDs are opaque labels, never package paths or helper-key fragments. */
export function validRuntimeNamespace(namespace: string): boolean {
  if (typeof namespace !== "string" || namespace.length === 0) return false;
  for (let index = 0; index < namespace.length; index++) {
    const code = namespace.charCodeAt(index);
    if (!(
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      code === 45 ||
      code === 46
    ))
      return false;
  }
  return true;
}

export const dynamicObjectRuntimeModule =
  "packages/native-runtime/src/values/dynamic-object.ts";
export const nativeValueViewsModule =
  "packages/native-runtime/src/intrinsics/value-views.ts";
export const nativeWeakModule =
  "packages/native-runtime/src/intrinsics/weak.ts";
/** The detachment of the program realm's projected native typed arrays, which
 * accompanies the dynamic-object runtime. */
export const nativeArrayDetachModule =
  "packages/native-runtime/src/intrinsics/native-array-detach.ts";

/** This provider uses module instance state and is demanded by the AOT checker. */
export function dynamicObjectRuntimeSource(
  patterns: boolean = false,
  projections: readonly string[] = [],
): RuntimeSource {
  const retainedExports = [
    "create",
    "createArray",
    "invoke",
    "finish",
    "enroll",
    "convertKey",
    "define",
    "setPrototype",
    "read",
    "project",
    "write",
    "update",
    "has",
    "remove",
    "spread",
    "enumerate",
    "advance",
    "objectConstructor",
    "invokeEnumeration",
    "speculativeBinary",
    "speculativeString",
    "speculativeUnary",
    "stringConstructor",
    "realmGlobal",
    "realmInstanceOf",
    "invokeArrayMethod",
    "projectNativeTypedArray",
  ];
  if (patterns) {
    retainedExports.push(
      "bindingObject",
      "bindingIterator",
      "bindingNext",
      "bindingSkip",
    );
    retainedExports.push("bindingTail", "bindingClose", "bindingRest");
  }
  for (const projection of projections) {
    if (projection === undefined) throw "native projection invariant";
    retainedExports.push(projection);
  }
  return {
    module: dynamicObjectRuntimeModule,
    namespace: "dynamic-object",
    retainedExports,
  };
}
