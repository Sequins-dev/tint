// LLDB batch commands that launch the target stopped at its entry point
// through tools/lldb/native_launch.py (`tint_start`), in place of
// `process launch --stop-at-entry` and an assertion of the stopped state.
// The SB API launch takes the same launch settings and flag but avoids about
// two seconds per launch that the batch-mode command spends.
import { fileURLToPath } from "node:url";

const driver = fileURLToPath(
  new URL("./lldb/native_launch.py", import.meta.url),
);

/** A shell-style quoted word, as `tint_start` splits its arguments. */
function quoted(text: string): string {
  return "'" + text.replaceAll("'", "'\\''") + "'";
}

/** `-o` arguments that import the driver and launch the target stopped at
 * entry, with standard streams optionally redirected to files. */
export function lldbStartCommands(
  streams: {
    readonly stdin?: string;
    readonly stdout?: string;
    readonly stderr?: string;
  } = {},
): string[] {
  let start = "tint_start";
  for (const [option, path] of [
    ["--stdin", streams.stdin],
    ["--stdout", streams.stdout],
    ["--stderr", streams.stderr],
  ] as const)
    if (path !== undefined) start += " " + option + " " + quoted(path);
  return ["-o", "command script import " + JSON.stringify(driver), "-o", start];
}
