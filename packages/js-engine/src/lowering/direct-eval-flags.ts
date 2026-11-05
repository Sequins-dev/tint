/** Static caller facts shared by lowering and direct-eval compilation.
 * Keep bit values stable across captured compiler/runtime snapshots. */
export const directEvalStrict = 1;
export const directEvalInFunction = 2;
export const directEvalInMethod = 4;
export const directEvalInDerivedConstructor = 8;
export const directEvalUnsupportedCapability = 16;
export const directEvalInPrivateEnvironment = 64;
export const directEvalInClassFieldInitializer = 32;
/** Reject inconsistent captured caller facts before parsing eval source. */
export function directEvalCapabilitiesConsistent(flags: number): boolean {
  if (
    (flags & directEvalInPrivateEnvironment) !== 0 &&
    (flags & directEvalStrict) === 0
  )
    return false;
  const method = (flags & directEvalInMethod) !== 0;
  const derived = (flags & directEvalInDerivedConstructor) !== 0;
  const field = (flags & directEvalInClassFieldInitializer) !== 0;
  if ((method || derived || field) && (flags & directEvalInFunction) === 0)
    return false;
  if ((derived || field) && !method) return false;
  return !(derived && field);
}
