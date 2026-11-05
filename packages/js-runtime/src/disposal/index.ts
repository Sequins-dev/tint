/** The owner retains callable handles without interpreting their host's values. */
export interface DisposalResource<Value> {
  readonly value: Value;
  readonly method: Value;
  readonly hint: "sync" | "async";
}
/** Mutate ownership through the protocol operations; disposal callbacks belong to
 * the embedding, after the resources have been detached from their owner. */
export interface DisposalStack<Value> {
  state: "pending" | "disposed";
  resources: DisposalResource<Value>[];
}
export function createDisposalStack<Value>(): DisposalStack<Value> {
  return { state: "pending", resources: [] };
}
export function pushDisposalResource<Value>(
  stack: DisposalStack<Value>,
  resource: DisposalResource<Value>,
): boolean {
  if (stack.state !== "pending") return false;
  stack.resources.push(resource);
  return true;
}
/** Close before any callback can run. The caller drains the returned list in
 * reverse registration order; repeated and reentrant closes have no resources. */
export function takeDisposalResources<Value>(
  stack: DisposalStack<Value>,
): DisposalResource<Value>[] | undefined {
  if (stack.state !== "pending") return undefined;
  const resources = stack.resources;
  stack.state = "disposed";
  stack.resources = [];
  return resources;
}
export function moveDisposalStack<Value>(
  stack: DisposalStack<Value>,
): DisposalStack<Value> | undefined {
  const resources = takeDisposalResources<Value>(stack);
  if (resources === undefined) return undefined;
  return { state: "pending", resources };
}
