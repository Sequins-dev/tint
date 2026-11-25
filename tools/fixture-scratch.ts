// Scratch locations for fixture inputs that a native image embeds: a library
// path it links or opens, files its program reads, a path it creates, debug
// information naming its source. A per-run temporary path there makes every
// build a different image; these paths depend only on a label and the
// checkout, so two runs of a test build byte-identical images. They live in
// the checkout's ignored .tint-bootstrap/scratch directory, which only the
// checkout's owner can write, not in a shared temporary directory where
// another user could create the path first. A checkout runs one gate at a
// time (docs/validation-gate.md), and each label belongs to one test file.
import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

/** The stable scratch path for `label` in this checkout (not created). */
export function stableScratchPath(label: string): string {
  return join(resolve("."), ".tint-bootstrap", "scratch", label);
}

/** An empty stable scratch directory for `label`, replacing any left by an
 * earlier run. Callers remove it when they are done. */
export function stableScratchDirectory(label: string): string {
  const directory = stableScratchPath(label);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  return directory;
}
