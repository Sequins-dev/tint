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

/** This provider uses module instance state and is demanded by the AOT checker. */
export function dynamicObjectRuntimeSource(): RuntimeSource {
  return {
    module: dynamicObjectRuntimeModule,
    namespace: "dynamic-object",
    retainedExports: [
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
      "has",
      "remove",
      "spread",
      "enumerate",
      "advance",
      "objectConstructor",
      "invokeEnumeration",
    ],
  };
}
