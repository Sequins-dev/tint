import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  watch,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
test("native run pause acknowledges a quiet checkpoint before allowing a diagnostic", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-run-control-"));
  const request = join(directory, "pause"),
    ack = request + ".ack",
    continued = join(directory, "continued"),
    journal = join(directory, "journal");
  writeFileSync(request, "");
  const source = `import {pauseNativeRun} from ${JSON.stringify(new URL("./native-run-control.ts", import.meta.url).href)};import {writeFileSync} from "node:fs";pauseNativeRun(${JSON.stringify(request)},record=>writeFileSync(${JSON.stringify(journal)},JSON.stringify(record)));writeFileSync(${JSON.stringify(continued)},"done");`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", source]);
  let stderr = "";
  child.stderr.on("data", (data) => (stderr += data));
  const exit = new Promise<number | null>((resolve) =>
    child.on("exit", resolve),
  );
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        observer.close();
        reject(Error("pause acknowledgement timed out: " + stderr));
      }, 5000);
      const check = () => {
        if (existsSync(ack)) {
          clearTimeout(timer);
          observer.close();
          resolve();
        }
      };
      const observer = watch(directory, check);
      // The child can publish before this process gets scheduled after spawn.
      // Observing the current state closes that gap without relying on an event.
      check();
      child.once("exit", () => {
        clearTimeout(timer);
        observer.close();
        if (!existsSync(ack))
          reject(Error("child exited before acknowledgement: " + stderr));
      });
    });
    assert.equal(JSON.parse(readFileSync(ack, "utf8")).pid, child.pid);
    assert.equal(existsSync(continued), false);
    rmSync(request);
    assert.equal(await exit, 0, stderr);
    assert.equal(readFileSync(continued, "utf8"), "done");
    assert.equal(existsSync(ack), false);
    const event = JSON.parse(readFileSync(journal, "utf8"));
    assert.equal(event.kind, "diagnostic-pause");
    assert.ok(event.elapsedMs >= 0);
  } finally {
    child.kill("SIGKILL");
    rmSync(directory, { recursive: true, force: true });
  }
});
