/** Host-created callables, stored in isolate-local program state. */
interface NodeScheduling {
  readonly nextTick: unknown;
  readonly setImmediate: unknown;
  readonly clearImmediate: unknown;
}

let scheduling: NodeScheduling | undefined = undefined;

export function installNodeScheduling(functions: NodeScheduling): void {
  scheduling = functions;
}

export function schedulingFunction(name: string): unknown {
  const current = scheduling;
  if (current === undefined) return undefined;
  switch (name) {
    case "nextTick":
      return current.nextTick;
    case "setImmediate":
      return current.setImmediate;
    case "clearImmediate":
      return current.clearImmediate;
  }
  return undefined;
}
