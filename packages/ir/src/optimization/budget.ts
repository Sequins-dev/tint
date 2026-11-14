/** The work budget of ahead-of-time builds: no limit. AOT may spend compile
 * time for faster code, so passes given this budget also lift the
 * per-function caps they derive from bounded budgets (which exist to keep
 * live compilation responsive). */
export const unboundedWork = Number.MAX_SAFE_INTEGER;

/** Whether a pass's remaining budget is the unbounded AOT budget (callers
 * subtract the work already spent, which stays far above any real bound). */
export function unbounded(budget: number): boolean {
  return budget >= unboundedWork / 2;
}
