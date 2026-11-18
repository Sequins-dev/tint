// First-launch admission for native fixture images under LLDB.
//
// macOS assesses each new executable file on its first exec, in one
// host-wide serial queue (see admitNativeFile in test262-native-process.ts);
// with many concurrent builds that exec can wait long enough for LLDB's
// launch to fail ("attach failed ... could not pause execution") before any
// native code runs. Fixtures that run under LLDB therefore admit each new
// image first: an untimed launch stopped at the entry point, then killed.
// Nothing runs past the entry point, so images that crash by design (the
// callback contract traps) never reach their fault or a Problem Report.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

/** Admit `binary` (a darwin image on a darwin host; elsewhere a no-op).
 * Throws when the admission launch itself fails, a host failure that is
 * reported as such rather than as the fixture's result. */
export function admitUnderLldb(binary: string): void {
  if (process.platform !== "darwin") return;
  const result = spawnSync(
    "lldb",
    [
      "--no-lldbinit",
      "--batch",
      // The exec waits in the assessment queue; let LLDB wait with it.
      "-o",
      "settings set plugin.process.gdb-remote.packet-timeout 600",
      "-o",
      "process launch --stop-at-entry",
      "-o",
      "script assert lldb.process.GetState() == lldb.eStateStopped",
      "-o",
      "process kill",
      binary,
    ],
    { encoding: "utf8" },
  );
  assert.equal(
    result.status,
    0,
    "native image admission (first launch, stopped at entry) failed for " +
      binary +
      ":\n" +
      result.stdout +
      result.stderr,
  );
}
