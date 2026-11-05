/** Inputs are bitsets of these five kinds; zero means no finite completion. Targets and payloads belong to lowering. */
export const normalCompletion = 1;
export const returnCompletion = 2;
export const breakCompletion = 4;
export const continueCompletion = 8;
export const throwCompletion = 16;

/** Only normal paths execute the following statement. */
export function sequenceCompletion(prior: number, next: number): number {
  return (
    (prior & ~normalCompletion) | ((prior & normalCompletion) !== 0 ? next : 0)
  );
}
/** Unknown expression effects can make the handler reachable without an explicit throw. */
export function catchCompletion(
  body: number,
  handler: number,
  mayThrow: boolean,
): number {
  return (
    (body & ~throwCompletion) |
    ((body & throwCompletion) !== 0 || mayThrow ? handler : 0)
  );
}
/** An abrupt finalizer replaces the pending completion; normal cleanup preserves it. */
export function finallyCompletion(pending: number, cleanup: number): number {
  if (pending === 0) return 0;
  return (
    (cleanup & ~normalCompletion) |
    ((cleanup & normalCompletion) !== 0 ? pending : 0)
  );
}
/** Consume loop-local break/continue; keep outward return and throw paths. */
export function loopCompletion(
  body: number,
  bodyFirst: boolean,
  unconditional: boolean = false,
): number {
  if (unconditional)
    return (
      (body & (returnCompletion | throwCompletion)) |
      ((body & breakCompletion) !== 0 ? normalCompletion : 0)
    );
  return (
    (body & (returnCompletion | throwCompletion)) |
    (!bodyFirst ||
    (body & (normalCompletion | breakCompletion | continueCompletion)) !== 0
      ? normalCompletion
      : 0)
  );
}
